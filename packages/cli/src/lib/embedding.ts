/**
 * CLI-local embedding generation for semantic recall.
 *
 * Mirrors packages/server/src/embeddings.ts's Ollama -> OpenAI fallback chain
 * and 1536-dim normalization. Deliberately NOT imported from @tages/server:
 * a runtime dependency on the server package would break `npm install -g
 * @tages/cli` standalone installs. Keep this file in sync with the server's
 * copy by hand if either fallback order or normalization logic changes.
 *
 * The OpenAI fallback is OPT-IN (env TAGES_OPENAI_EMBED=1), off by default,
 * for two reasons:
 *
 *   1. Hot-path cost/latency (finding 6): recall runs `generateEmbedding` on
 *      every query. When Ollama is down, an automatic OpenAI fallback turns
 *      recall into a blocking, billable, up-to-10s network call on the read
 *      path. Fail-fast to trigram instead — return null so the caller skips
 *      semantic search.
 *
 *   2. Vector-space consistency (finding 5): a query embedded with OpenAI
 *      text-embedding-3-small (native 1536-dim) and documents embedded with
 *      Ollama nomic-embed-text (768-dim zero-padded to 1536) live in DIFFERENT
 *      vector spaces; their cosine similarity is meaningless. Gating both the
 *      write and the recall path on the SAME env flag keeps the whole index
 *      single-provider: either everything is Ollama (default) or, if the user
 *      opts in, everything is OpenAI. We never silently mix the two.
 *
 * TODO (full fix for finding 5): record the embedding model on each memory row
 * (e.g. an `embedding_model` column) and only run semantic recall when the
 * query can be embedded with that same model, falling back to trigram per-row
 * otherwise. That removes the "one provider per whole index" restriction. The
 * env-flag approach here is the conservative version that avoids a schema
 * change while still guaranteeing query and documents share a vector space.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

function openAIFallbackEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit
  return process.env.TAGES_OPENAI_EMBED === '1' || process.env.TAGES_OPENAI_EMBED === 'true'
}

export interface GenerateEmbeddingOptions {
  /**
   * Allow falling back to the paid OpenAI embeddings API when Ollama is
   * unavailable. Defaults to the TAGES_OPENAI_EMBED env flag (off). Pass
   * `false` explicitly to force fail-fast even when the env flag is set.
   */
  allowOpenAIFallback?: boolean
}

export async function generateEmbedding(
  text: string,
  opts: GenerateEmbeddingOptions = {},
): Promise<number[] | null> {
  // Try Ollama first (local, fast)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok) {
      const data = await res.json() as { embedding: number[] }
      if (data.embedding?.length > 0) return normalizeTo1536(data.embedding)
    }
  } catch {
    // Ollama not available
  }

  // Fall back to OpenAI-compatible API only when explicitly opted in.
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey && openAIFallbackEnabled(opts.allowOpenAIFallback)) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json() as { data: Array<{ embedding: number[] }> }
        if (data.data?.[0]?.embedding) return normalizeTo1536(data.data[0].embedding)
      }
    } catch {
      // OpenAI not available
    }
  }

  return null
}

function normalizeTo1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding
  if (embedding.length > 1536) {
    const truncated = embedding.slice(0, 1536)
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0))
    if (norm === 0) return truncated
    return truncated.map((v) => v / norm)
  }
  return [...embedding, ...new Array(1536 - embedding.length).fill(0)]
}
