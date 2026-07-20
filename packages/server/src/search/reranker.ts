/**
 * Cross-encoder rerank pass for the MCP-server recall path (PLAN.md Task 6).
 *
 * Server-package duplicate of the CLI's `packages/cli/src/lib/reranker.ts`
 * (Task 2) — hand-duplicated per this repo's per-package convention
 * (`embedding.ts`, `chunking.ts`, `date-extraction.ts` are each already
 * duplicated the same way; see CLAUDE.md / SPLIT.md Standing Rules). No
 * cross-package import.
 *
 * `OpenAIJudgeReranker` is the sole `Reranker` implementation: one
 * `gpt-4o-mini` listwise chat-completion call over the candidate window.
 * (A local ONNX cross-encoder implementation previously lived here behind
 * the same interface; dropped per PLAN.md Task 1 — see CHANGELOG.)
 *
 * If no `OPENAI_API_KEY` is configured (or the call fails), `rerank()` fails
 * open: input order unchanged, no throw — same philosophy as
 * `generateEmbedding`'s fallback chain in `embeddings.ts`.
 */

export interface RerankCandidate {
  id: string
  text: string
}

export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]>
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

      // Extract the JSON array even when the model wraps it in a ```json fence
      // or a leading sentence (common despite "JSON only" prompts). A bare
      // JSON.parse(content) would throw on any such wrapping and silently
      // no-op the rerank; slice from the first '[' to the last ']' instead.
      // Mirrors the CLI copy's array-extraction guard.
      const start = content.indexOf('[')
      const end = content.lastIndexOf(']')
      if (start === -1 || end === -1 || end < start) return window.map((c) => c.id)
      const parsed: unknown = JSON.parse(content.slice(start, end + 1))
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
 * The OpenAI-judge rerank pass is opt-in: it runs only when BOTH
 * `OPENAI_API_KEY` and `TAGES_OPENAI_EMBED` are set. `OPENAI_API_KEY` alone is
 * routinely present for embeddings, so gating on it would fire a live
 * `gpt-4o-mini` call (latency + token cost) on every recall — and rerank
 * measured net-neutral on the eval, so it is not worth paying for by default.
 * Kept in parity with the CLI copy's `openAiJudgeAvailable()`.
 */
function openAiJudgeAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.TAGES_OPENAI_EMBED)
}

/**
 * Run the OpenAI-judge reranker, failing open (input order unchanged, no
 * throw) when the pass is not opted in, no API key is configured, or the
 * judge call itself fails.
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<string[]> {
  if (candidates.length === 0) return []
  if (!openAiJudgeAvailable()) return candidates.slice(0, topK).map((c) => c.id)
  try {
    return await new OpenAIJudgeReranker().rerank(query, candidates, topK)
  } catch {
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
