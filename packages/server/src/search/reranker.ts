/**
 * Cross-encoder rerank pass for the MCP-server recall path (PLAN.md Task 6).
 *
 * Server-package duplicate of the CLI's `packages/cli/src/lib/reranker.ts`
 * (Task 2) — hand-duplicated per this repo's per-package convention
 * (`embedding.ts`, `chunking.ts`, `date-extraction.ts` are each already
 * duplicated the same way; see CLAUDE.md / SPLIT.md Standing Rules). No
 * cross-package import.
 *
 * Two implementations behind the same `Reranker` interface:
 *  - `LocalCrossEncoderReranker` — Xenova/ms-marco-MiniLM-L-6-v2 via
 *    `@huggingface/transformers` (ONNX runtime, CPU inference, cached to
 *    disk on first use). Tried first.
 *  - `OpenAIJudgeReranker` — one `gpt-4o-mini` listwise chat-completion call
 *    over the same candidate window. Fallback when the local model can't be
 *    loaded and `OPENAI_API_KEY` is set.
 *
 * If neither is available, `rerank()` fails open: input order unchanged, no
 * throw — same philosophy as `generateEmbedding`'s fallback chain in
 * `embeddings.ts`.
 */

export interface RerankCandidate {
  id: string
  text: string
}

export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]>
}

const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

// Minimal shape of the transformers.js text-classification pipeline callable
// this module depends on. Not verified against the installed package's exact
// runtime signature in this pass (per PLAN.md's own "not hand-tested in this
// planning pass" pattern for new-dependency integration points) — the E2E
// real-product probe (PLAN.md Task 6 E2E Validation) is what actually
// exercises this against the real package; unit tests mock this type's shape
// entirely and never load the real model (see reranker.test.ts).
type ClassifyFn = (
  query: string,
  texts: string[],
) => Promise<Array<{ label: string; score: number }> | { label: string; score: number }>

let pipelinePromise: Promise<ClassifyFn> | null = null

async function loadPipeline(): Promise<ClassifyFn> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import keeps this heavy optional dependency out of the
      // module graph for callers that never rerank (the fail-open paths
      // below never pay the load cost, and this call is what
      // reranker.test.ts mocks via vi.mock('@huggingface/transformers')).
      const mod = await import('@huggingface/transformers')
      const p = await mod.pipeline('text-classification', MODEL_ID)
      return p as unknown as ClassifyFn
    })()
  }
  return pipelinePromise
}

export class LocalCrossEncoderReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
    if (candidates.length === 0) return []
    const classify = await loadPipeline()
    const window = candidates.slice(0, topK)
    const scored = await Promise.all(
      window.map(async (c) => {
        const result = await classify(query, [c.text])
        const row = Array.isArray(result) ? result[0] : result
        const score = typeof row?.score === 'number' ? row.score : 0
        return { id: c.id, score }
      }),
    )
    scored.sort((a, b) => b.score - a.score)
    return scored.map((s) => s.id)
  }
}

export class OpenAIJudgeReranker implements Reranker {
  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> {
    const apiKey = process.env.OPENAI_API_KEY
    const window = candidates.slice(0, topK)
    if (!apiKey) return window.map((c) => c.id)

    try {
      const prompt = [
        `Query: ${query}`,
        '',
        'Candidates (id: text):',
        ...window.map((c, i) => `${i + 1}. [${c.id}] ${c.text.slice(0, 500)}`),
        '',
        'Return a JSON array of candidate ids ordered from most to least relevant ' +
          'to the query. Only include ids from the list above. Respond with JSON ' +
          'only, no prose.',
      ].join('\n')

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return window.map((c) => c.id)

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (!content) return window.map((c) => c.id)

      const parsed: unknown = JSON.parse(content)
      if (!Array.isArray(parsed)) return window.map((c) => c.id)

      const validIds = new Set(window.map((c) => c.id))
      const ordered = parsed.filter((id): id is string => typeof id === 'string' && validIds.has(id))
      // Append any candidate the judge omitted, preserving original order — never drop a row.
      const seen = new Set(ordered)
      for (const c of window) {
        if (!seen.has(c.id)) ordered.push(c.id)
      }
      return ordered
    } catch {
      return window.map((c) => c.id)
    }
  }
}

/**
 * Select and run the best available reranker: local cross-encoder first (no
 * network call after first model download), OpenAI-judge fallback when the
 * local model can't load and an API key is configured, else fail-open
 * (input order unchanged, no throw).
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<string[]> {
  if (candidates.length === 0) return []
  try {
    return await new LocalCrossEncoderReranker().rerank(query, candidates, topK)
  } catch {
    if (process.env.OPENAI_API_KEY) {
      try {
        return await new OpenAIJudgeReranker().rerank(query, candidates, topK)
      } catch {
        return candidates.slice(0, topK).map((c) => c.id)
      }
    }
    return candidates.slice(0, topK).map((c) => c.id)
  }
}

/**
 * Rerank a Memory-shaped list: the top `topK` candidates go through the
 * cross-encoder (or fallback/no-op) pass and are re-spliced to the front;
 * everything beyond `topK` keeps its incoming (RRF/relevance) order,
 * appended after — mirrors the CLI's Task 2 splice behavior
 * (`packages/cli/src/commands/recall.ts`).
 */
export async function rerankMemories<T extends { id: string; value: string }>(
  memories: T[],
  query: string,
  topK = 20,
): Promise<T[]> {
  if (memories.length === 0) return memories
  const window = memories.slice(0, topK)
  const rest = memories.slice(topK)
  const candidates: RerankCandidate[] = window.map((m) => ({ id: m.id, text: m.value }))
  const orderedIds = await rerank(query, candidates, topK)

  const byId = new Map(window.map((m) => [m.id, m]))
  const reordered: T[] = []
  for (const id of orderedIds) {
    const m = byId.get(id)
    if (m) {
      reordered.push(m)
      byId.delete(id)
    }
  }
  // Preserve original relative order for any window item the reranker didn't
  // return (defensive — the fail-open paths above always return every id,
  // but this never silently drops a row if that invariant ever breaks).
  for (const m of window) {
    if (byId.has(m.id)) reordered.push(m)
  }

  return [...reordered, ...rest]
}
