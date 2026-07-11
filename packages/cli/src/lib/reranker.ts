/**
 * Cross-encoder rerank pass over the CLI's RRF-fused candidate pool (PLAN.md
 * Task 2). Two implementations behind a shared `Reranker` interface:
 *
 *  - `LocalCrossEncoderReranker` (primary): scores each (query, candidate)
 *    pair locally via `Xenova/ms-marco-MiniLM-L-6-v2` through
 *    `@huggingface/transformers`'s pipeline API (ONNX runtime, CPU inference,
 *    cached to disk after the first load, no network call after that).
 *  - `OpenAIJudgeReranker` (fallback): one `gpt-4o-mini` listwise
 *    chat-completion call over the same candidate window, used only when the
 *    local model can't be loaded/run and `OPENAI_API_KEY` +
 *    `TAGES_OPENAI_EMBED` are both set.
 *
 * `rerankCandidates` is the orchestrator recall.ts calls: try the local
 * cross-encoder first; on any load/inference failure, fall back to the
 * OpenAI judge if opted in; if neither is available, fail open and return
 * the input order unchanged (same fail-open philosophy as
 * lib/embedding.ts's generateEmbedding) rather than throwing or hanging.
 */

export interface RerankCandidate {
  id: string
  text: string
}

export interface Reranker {
  /** Returns candidate ids in ranked order (best match first). */
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]>
}

// Minimal structural shapes of the transformers.js primitives this module
// uses. ms-marco-MiniLM-L-6-v2 is a *regression* cross-encoder (one raw
// relevance logit per query/passage pair), NOT a classifier — so it must be
// run via the tokenizer + sequence-classification model and its raw
// `logits`, NOT the `text-classification` pipeline. The pipeline applies a
// sigmoid/softmax that saturates every pair to score 1.0, silently reducing
// rerank to a stable-sort no-op (confirmed empirically 2026-07-10 against
// the installed package: relevant/irrelevant both returned score 1). The
// raw-logit path gives real separation (relevant +7.7 vs irrelevant -11.4).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tokenizer = (text: string, opts?: Record<string, unknown>) => any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClassifierModel = (inputs: any) => Promise<{ logits: { data: ArrayLike<number> } }>

const LOCAL_RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2'
// Cold-start cap: first use downloads the ONNX weights (~90MB). Without a
// bound, a slow/stalled Hub fetch would hang recall indefinitely — fail-open
// only catches throws, not hangs (White W1). On timeout we reject, which
// rerankCandidates' try/catch converts to the input-order fallback.
const MODEL_LOAD_TIMEOUT_MS = 30_000

// Lazily-loaded, cached across calls within a process. Not module-top-level
// eager, so importing this file never triggers a model download on its own
// (only calling LocalCrossEncoderReranker.rerank does).
let cachedModelPromise: Promise<{ tokenizer: Tokenizer; model: ClassifierModel }> | null = null

async function loadLocalModel(): Promise<{ tokenizer: Tokenizer; model: ClassifierModel }> {
  if (!cachedModelPromise) {
    cachedModelPromise = (async () => {
      // Dynamic import: keeps this dependency lazy (only paid for when
      // rerank actually runs) and keeps the import mockable per-test without
      // affecting every other CLI test that transitively imports this file.
      const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
      const [tokenizer, model] = await Promise.all([
        AutoTokenizer.from_pretrained(LOCAL_RERANK_MODEL),
        AutoModelForSequenceClassification.from_pretrained(LOCAL_RERANK_MODEL, { dtype: 'fp32' }),
      ])
      return { tokenizer: tokenizer as unknown as Tokenizer, model: model as unknown as ClassifierModel }
    })()
    // A failed load must not be cached forever: `Promise.catch` here (not on
    // the value we return above) clears the cache on rejection so the next
    // call retries the load instead of replaying a stale failure — and so
    // tests that flip the mock between success/failure per-case stay
    // isolated from each other's cached result.
    cachedModelPromise.catch(() => {
      cachedModelPromise = null
    })
  }
  return cachedModelPromise
}

async function loadLocalModelWithTimeout(): Promise<{ tokenizer: Tokenizer; model: ClassifierModel }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('local reranker model load timed out')), MODEL_LOAD_TIMEOUT_MS)
  })
  try {
    return await Promise.race([loadLocalModel(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Test-only: clears the module-level model cache between test cases. */
export function __resetLocalPipelineCacheForTests(): void {
  cachedModelPromise = null
}

export class LocalCrossEncoderReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
    if (candidates.length === 0) return []
    const { tokenizer, model } = await loadLocalModelWithTimeout()

    // Score the window concurrently (parity with the server copy) rather than
    // serializing every inference in an await-in-for-loop.
    const scored = await Promise.all(
      candidates.map(async (candidate) => {
        // Cross-encoder pair scoring: query + passage as a sentence pair, read
        // the single raw relevance logit (higher = more relevant).
        const inputs = tokenizer(query, { text_pair: candidate.text, padding: true, truncation: true })
        const { logits } = await model(inputs)
        const score = Number(logits.data[0])
        return { id: candidate.id, score: Number.isFinite(score) ? score : -Infinity }
      }),
    )

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map((s) => s.id)
  }
}

export class OpenAIJudgeReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
    if (candidates.length === 0) return []

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OpenAIJudgeReranker requires OPENAI_API_KEY')
    }

    const numbered = candidates.map((c, i) => `[${i}] ${c.text}`).join('\n\n')
    const prompt =
      `Query: ${query}\n\nRank the following passages from most to least relevant to the query. ` +
      `Respond with ONLY a JSON array of the passage indices in ranked order (best first), e.g. [2,0,1].\n\n${numbered}`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI rerank request failed: ${response.status}`)
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content: unknown = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('OpenAI rerank response missing content')
    }

    const match = content.match(/\[[\d,\s]*\]/)
    if (!match) {
      throw new Error('OpenAI rerank response did not contain a JSON array')
    }

    const indices: unknown = JSON.parse(match[0])
    if (!Array.isArray(indices)) {
      throw new Error('OpenAI rerank response JSON array malformed')
    }

    const ids: string[] = []
    for (const idx of indices) {
      if (typeof idx === 'number' && candidates[idx]) {
        ids.push(candidates[idx].id)
      }
    }
    if (ids.length === 0) {
      throw new Error('OpenAI rerank response produced no valid indices')
    }

    return ids.slice(0, topK)
  }
}

function openAiJudgeAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.TAGES_OPENAI_EMBED)
}

/**
 * Orchestrates reranker selection with fail-open behavior. Never throws:
 * local cross-encoder -> OpenAI judge (if opted in) -> input order unchanged.
 */
export async function rerankCandidates(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<string[]> {
  if (candidates.length === 0) return []

  try {
    const local = new LocalCrossEncoderReranker()
    return await local.rerank(query, candidates, topK)
  } catch {
    if (openAiJudgeAvailable()) {
      try {
        const judge = new OpenAIJudgeReranker()
        return await judge.rerank(query, candidates, topK)
      } catch {
        return candidates.map((c) => c.id)
      }
    }
    return candidates.map((c) => c.id)
  }
}
