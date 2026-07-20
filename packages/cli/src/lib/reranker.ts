/**
 * Cross-encoder rerank pass over the CLI's RRF-fused candidate pool (PLAN.md
 * Task 2). `OpenAIJudgeReranker` is the sole `Reranker` implementation: one
 * `gpt-4o-mini` listwise chat-completion call over the candidate window,
 * used only when `OPENAI_API_KEY` + `TAGES_OPENAI_EMBED` are both set.
 *
 * (A local ONNX cross-encoder implementation previously lived here behind
 * the same interface; dropped per PLAN.md Task 1 — see CHANGELOG.)
 *
 * `rerankCandidates` is the orchestrator recall.ts calls: run the OpenAI
 * judge if opted in; if not opted in, or the judge call fails, fail open and
 * return the input order unchanged (same fail-open philosophy as
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
      // Bound the request so a stalled endpoint can't hang recall indefinitely.
      // Matches the server copy (packages/server/src/search/reranker.ts); a
      // timeout aborts the fetch, which the rerankCandidates() catch turns
      // into a fail-open input-order return. Replaces the hang-protection the
      // dropped local model's MODEL_LOAD_TIMEOUT_MS used to provide.
      signal: AbortSignal.timeout(15_000),
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
 * OpenAI judge (if opted in) -> input order unchanged.
 */
export async function rerankCandidates(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
): Promise<string[]> {
  if (candidates.length === 0) return []

  if (!openAiJudgeAvailable()) {
    return candidates.map((c) => c.id)
  }

  try {
    const judge = new OpenAIJudgeReranker()
    return await judge.rerank(query, candidates, topK)
  } catch {
    return candidates.map((c) => c.id)
  }
}
