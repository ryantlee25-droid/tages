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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TransformersPipeline = (input: string, options?: Record<string, unknown>) => Promise<any>

const LOCAL_RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2'

// Lazily-loaded, cached across calls within a process. Not module-top-level
// eager, so importing this file never triggers a model download on its own
// (only calling LocalCrossEncoderReranker.rerank does).
let cachedPipelinePromise: Promise<TransformersPipeline> | null = null

async function loadLocalPipeline(): Promise<TransformersPipeline> {
  if (!cachedPipelinePromise) {
    cachedPipelinePromise = (async () => {
      // Dynamic import: keeps this dependency lazy (only paid for when
      // rerank actually runs) and keeps the import mockable per-test without
      // affecting every other CLI test that transitively imports this file.
      const { pipeline } = await import('@huggingface/transformers')
      return pipeline('text-classification', LOCAL_RERANK_MODEL) as unknown as Promise<TransformersPipeline>
    })()
    // A failed load must not be cached forever: `Promise.catch` here (not on
    // the value we return above) clears the cache on rejection so the next
    // call retries the load instead of replaying a stale failure — and so
    // tests that flip the mock between success/failure per-case stay
    // isolated from each other's cached result.
    cachedPipelinePromise.catch(() => {
      cachedPipelinePromise = null
    })
  }
  return cachedPipelinePromise
}

/** Test-only: clears the module-level pipeline cache between test cases. */
export function __resetLocalPipelineCacheForTests(): void {
  cachedPipelinePromise = null
}

export class LocalCrossEncoderReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
    if (candidates.length === 0) return []
    const classify = await loadLocalPipeline()

    const scored: Array<{ id: string; score: number }> = []
    for (const candidate of candidates) {
      const result = await classify(query, { text_pair: candidate.text })
      const first = Array.isArray(result) ? result[0] : result
      const score = typeof first?.score === 'number' ? first.score : 0
      scored.push({ id: candidate.id, score })
    }

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
