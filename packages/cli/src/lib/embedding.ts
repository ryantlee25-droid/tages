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
 *
 * Bug fix (chunking): OpenAI's text-embedding-3-small caps input at 8192
 * tokens. Previously, a memory value over that limit got an HTTP 400 back
 * from OpenAI, and because only the `if (res.ok)` branch was handled, the
 * 400 fell straight through to `return null` with the error body never
 * read — the memory silently got NO embedding and dropped out of semantic
 * recall with no error surfaced anywhere. Long OpenAI-fallback inputs are
 * now split into overlapping chunks (see ./chunking.ts, which also documents
 * the pooling-vs-multi-row-storage decision), each chunk is embedded
 * separately, and the resulting vectors are mean-pooled + L2-renormalized
 * into one 1536-dim vector — same shape normalizeTo1536 already expects, so
 * this function's exported signature and every call site are unchanged. All
 * non-OK HTTP responses are now read and logged (never silently swallowed),
 * and 429s are retried with backoff (respecting a `Retry-After` header when
 * present).
 */

import { chunkText, estimateTokenCount, SAFE_SINGLE_CALL_TOKEN_LIMIT } from './chunking.js'

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
    const data = await fetchEmbeddingJson(
      `${OLLAMA_URL}/api/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      },
      'Ollama',
      3000,
    ) as { embedding: number[] } | null
    if (data && data.embedding && data.embedding.length > 0) return normalizeTo1536(data.embedding)
  } catch {
    // Ollama not available
  }

  // Fall back to OpenAI-compatible API only when explicitly opted in.
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey && openAIFallbackEnabled(opts.allowOpenAIFallback)) {
    try {
      // Text over the safe single-call threshold gets chunked + pooled;
      // everything else takes the original single-request path unchanged.
      if (estimateTokenCount(text) > SAFE_SINGLE_CALL_TOKEN_LIMIT) {
        return await embedLongTextViaOpenAI(text, openaiKey)
      }

      const data = await fetchEmbeddingJson(
        'https://api.openai.com/v1/embeddings',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
        },
        'OpenAI',
        10000,
      ) as { data: Array<{ embedding: number[] }> } | null
      if (data?.data?.[0]?.embedding) return normalizeTo1536(data.data[0].embedding)
    } catch {
      // OpenAI not available
    }
  }

  return null
}

/**
 * Embed text that exceeds the safe single-call token threshold by splitting
 * it into overlapping chunks (chunking.ts), embedding each chunk separately
 * via the same OpenAI endpoint, and mean-pooling + renormalizing the results
 * into one 1536-dim vector.
 *
 * A single failed chunk invalidates the whole pooled result (returns null)
 * rather than silently pooling a subset.
 */
async function embedLongTextViaOpenAI(text: string, apiKey: string): Promise<number[] | null> {
  const chunks = chunkText(text)
  const chunkEmbeddings: number[][] = []

  for (const chunk of chunks) {
    const data = await fetchEmbeddingJson(
      'https://api.openai.com/v1/embeddings',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: chunk }),
      },
      'OpenAI (chunk)',
      10000,
    ) as { data: Array<{ embedding: number[] }> } | null

    const embedding = data?.data?.[0]?.embedding
    if (!embedding) return null
    chunkEmbeddings.push(embedding)
  }

  if (chunkEmbeddings.length === 0) return null

  // Degenerate mean guard (W1): if the pooled vector's norm is ~0 (e.g. chunk
  // embeddings that cancel out), normalizing would yield an all-zero vector,
  // which stores as a zero embedding -> NaN cosine -> the memory silently never
  // matches. Treat that as "no embedding" (return null) rather than persisting
  // a poisoned vector.
  const pooled = meanPool(chunkEmbeddings)
  const pooledNorm = Math.sqrt(pooled.reduce((sum, x) => sum + x * x, 0))
  if (!(pooledNorm > 1e-8)) return null
  return normalizeTo1536(pooled.map((x) => x / pooledNorm))
}

/**
 * Mean-pool a set of equal-dimension vectors, returning the raw (un-normalized)
 * average. The caller (embedLongTextViaOpenAI) checks the pooled norm for the
 * degenerate near-zero case before L2-renormalizing, so normalization is owned
 * there rather than hidden here.
 */
function meanPool(vectors: number[][]): number[] {
  const dim = vectors[0].length
  const sums = new Array(dim).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sums[i] += v[i]
  }
  return sums.map((s) => s / vectors.length)
}

/**
 * fetch() + JSON-parse an embeddings endpoint response, with 429 retry-with-
 * backoff (respecting a `Retry-After` header when present) and error-body
 * logging for every other non-OK response. Returns null (after logging) on a
 * non-retryable failure rather than throwing, matching this module's
 * existing "no provider available" contract.
 */
// Upper bound on cumulative 429 backoff. Even though the recall path gates the
// OpenAI fallback off by default, keep this identical to the server so the
// twins don't drift: an unbounded `Retry-After` must never turn a retry into a
// multi-minute hang. Once the budget is spent, stop retrying and return null.
const MAX_TOTAL_RETRY_DELAY_MS = 2000

async function fetchEmbeddingJson(
  url: string,
  init: RequestInit,
  providerLabel: string,
  timeoutMs: number,
  maxRetries = 3,
): Promise<unknown | null> {
  let spentDelayMs = 0
  for (let attempt = 0; ; attempt++) {
    // Fresh per-attempt timeout: a single shared AbortSignal.timeout would
    // fire at a fixed wall-clock instant and abort a backed-off retry before
    // it even starts, re-introducing the silent-embedding-loss this fixes.
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })

    if (res.ok) return res.json()

    if (res.status === 429 && attempt < maxRetries && spentDelayMs < MAX_TOTAL_RETRY_DELAY_MS) {
      const delayMs = Math.min(retryDelayMs(res, attempt), MAX_TOTAL_RETRY_DELAY_MS - spentDelayMs)
      spentDelayMs += delayMs
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    const body = await res.text().catch(() => '<unreadable response body>')
    console.error(`[embedding] ${providerLabel} request failed with status ${res.status}: ${body}`)
    return null
  }
}

/** Requested backoff for a 429, honoring a numeric `Retry-After` header. */
function retryDelayMs(res: Response, attempt: number): number {
  const retryAfterHeader = res.headers?.get?.('retry-after')
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? retryAfterSeconds * 1000
    : 2 ** attempt * 100 // 100ms, 200ms, 400ms...
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
