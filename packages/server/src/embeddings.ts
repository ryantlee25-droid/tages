/**
 * Embedding generation for semantic search.
 * Tries providers in order: local Ollama → OpenAI-compatible API → skip.
 *
 * Uses 1536-dimension embeddings (OpenAI-compatible) for pgvector.
 * Ollama uses nomic-embed-text; Anthropic doesn't have embeddings,
 * so we fall back to OpenAI-compatible API if OPENAI_API_KEY is set.
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
 * every existing caller (scheduleEmbeddingSync in tools/remember.ts,
 * recall.ts, backfill-embeddings.ts) needs zero changes. All non-OK HTTP
 * responses are now read and logged (never silently swallowed), and 429s are
 * retried with backoff (respecting a `Retry-After` header when present).
 *
 * Multi-vector chunk storage (Task 9, Phase 2): `generateChunkEmbeddings`
 * below is a SEPARATE entry point from `generateEmbedding`, added for the new
 * per-chunk `memory_chunks` table rather than folded into the pooled path.
 * It reuses `chunkText()` and, per chunk, the SAME single-text embed helper
 * (`embedOne`) that generateEmbedding's short-text path uses — Ollama-first,
 * then OpenAI (Fix A). Previously it was OpenAI-only, so whenever Ollama was
 * running the query (Ollama-space) and the stored chunks (OpenAI-space) lived
 * in different vector spaces and their cosine was meaningless, silently
 * zero-ing the chunk channel AND billing OpenAI even for Ollama-only users.
 * `generateEmbedding()`'s external behavior is unchanged by this addition.
 */

import { chunkText, estimateTokenCount, SAFE_SINGLE_CALL_TOKEN_LIMIT } from './chunking'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // Long OpenAI-fallback inputs still chunk+pool (embedLongTextViaOpenAI), but
  // only AFTER Ollama misses on the whole text — Ollama gets the whole input
  // first, exactly as before. Every other (short-text) case goes through the
  // shared single-text `embedOne` helper, which is the SAME provider-selection
  // path `generateChunkEmbeddings` uses per chunk (Fix A). That shared path is
  // what guarantees query vectors and chunk vectors always live in the same
  // vector space — before, chunks were OpenAI-only while queries were
  // Ollama-first, so their cosine was meaningless whenever Ollama was running.
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey && estimateTokenCount(text) > SAFE_SINGLE_CALL_TOKEN_LIMIT) {
    const ollama = await embedViaOllama(text)
    if (ollama) return ollama
    return await embedLongTextViaOpenAI(text, openaiKey)
  }
  return embedOne(text)
}

/**
 * Embed a single text via the local Ollama endpoint, normalized to 1536 dims.
 * Returns null (never throws) when Ollama is unavailable, so callers can fall
 * through to the next provider.
 */
async function embedViaOllama(text: string): Promise<number[] | null> {
  try {
    const data = await fetchEmbeddingJson(
      `${OLLAMA_URL}/api/embeddings`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text,
        }),
      },
      'Ollama',
      5000,
    ) as { embedding: number[] } | null

    if (data && data.embedding && data.embedding.length > 0) {
      // Pad or truncate to 1536 dims
      return normalizeTo1536(data.embedding)
    }
  } catch {
    // Ollama not available
  }
  return null
}

/**
 * Embed a single text (a query, or ONE already-chunk-sized passage) using the
 * SAME provider selection as generateEmbedding's short-text path: Ollama-first,
 * then OpenAI (gated on OPENAI_API_KEY, exactly as generateEmbedding is). This
 * is the shared helper `generateChunkEmbeddings` calls per chunk (Fix A), so
 * chunk vectors and query vectors are always produced by the same provider and
 * are comparable in one vector space. Assumes `text` already fits a single
 * embed call (chunkText upstream guarantees chunk-sized input); the long-text
 * chunk+pool path stays in generateEmbedding/embedLongTextViaOpenAI.
 */
async function embedOne(text: string): Promise<number[] | null> {
  const ollama = await embedViaOllama(text)
  if (ollama) return ollama

  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      return await embedSingleChunkViaOpenAI(text, openaiKey)
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
 * rather than silently pooling a subset — a partial pool would be a
 * plausible-looking but semantically incomplete vector, which is exactly the
 * kind of silent degradation this fix is meant to eliminate.
 */
async function embedLongTextViaOpenAI(text: string, apiKey: string): Promise<number[] | null> {
  const chunks = chunkText(text)
  const chunkEmbeddings: number[][] = []

  for (const chunk of chunks) {
    const embedding = await embedSingleChunkViaOpenAI(chunk, apiKey)
    if (!embedding) return null
    chunkEmbeddings.push(embedding)
  }

  if (chunkEmbeddings.length === 0) return null
  return poolChunkEmbeddings(chunkEmbeddings)
}

/**
 * Embed a single chunk of text via OpenAI's embeddings endpoint, normalized
 * to 1536 dims. Factored out of `embedLongTextViaOpenAI` so both the pooled
 * long-text path and `generateChunkEmbeddings` (Task 9) share exactly one
 * per-chunk embed call instead of drifting apart.
 */
async function embedSingleChunkViaOpenAI(chunk: string, apiKey: string): Promise<number[] | null> {
  const data = await fetchEmbeddingJson(
    'https://api.openai.com/v1/embeddings',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: chunk,
      }),
    },
    'OpenAI (chunk)',
    10000,
  ) as { data: Array<{ embedding: number[] }> } | null

  const embedding = data?.data?.[0]?.embedding
  return embedding ? normalizeTo1536(embedding) : null
}

/**
 * Mean-pool + L2-renormalize a set of chunk embeddings into one 1536-dim
 * vector. Shared by `embedLongTextViaOpenAI` (pooled single-vector path) and
 * `generateChunkEmbeddings` (per-chunk storage path, which also returns this
 * as its convenience `pooled` field).
 *
 * Degenerate mean guard (W1): if the pooled vector's norm is ~0 (e.g. chunk
 * embeddings that cancel out), normalizing would yield an all-zero vector,
 * which stores as a zero embedding -> NaN cosine -> the memory silently never
 * matches. Treat that as "no embedding" (return null) rather than persisting
 * a poisoned vector.
 */
function poolChunkEmbeddings(chunkEmbeddings: number[][]): number[] | null {
  const pooled = meanPool(chunkEmbeddings)
  const pooledNorm = Math.sqrt(pooled.reduce((sum, x) => sum + x * x, 0))
  if (!(pooledNorm > 1e-8)) return null
  return normalizeTo1536(pooled.map((x) => x / pooledNorm))
}

/**
 * Generate per-chunk embeddings for multi-vector chunk storage (Task 9,
 * Phase 2), alongside (not instead of) the existing pooled `generateEmbedding`.
 *
 * Same provider selection as generateEmbedding (Fix A): each chunk is embedded
 * via `embedOne` (Ollama-first, then OpenAI), so chunk vectors, the pooled
 * vector, AND the query vector are always produced by the same provider/model
 * — required for chunk-level and pooled cosine similarity to be comparable in
 * one vector space. Returns null (no chunks persisted) only when NO provider is
 * available at all (embedOne returns null), mirroring the rest of this module's
 * "no provider available -> null" contract. In the OpenAI-only eval config (no
 * Ollama, OPENAI_API_KEY set) embedOne yields OpenAI vectors, so this returns
 * OpenAI chunk vectors exactly as before.
 *
 * Fail-closed for chunk storage (distinct from the pooled path's fail-open
 * contract): if ANY individual chunk fails to embed, the whole result is
 * discarded (returns null) rather than persisting a partial, silently
 * incomplete chunk set for the memory — a caller (remember.ts) that gets
 * null here simply skips writing chunk rows this time; the pooled embedding
 * write (a separate, independent call) is entirely unaffected.
 *
 * Short text (<= the chunking threshold) still chunks cleanly: `chunkText`
 * returns a single-element array equal to the whole input, so this produces
 * exactly one chunk row whose embedding is identical (mod pooling arithmetic)
 * to `pooled` — single-chunk parity with the short-text case.
 */
export async function generateChunkEmbeddings(
  text: string,
): Promise<{ pooled: number[] | null; chunks: Array<{ text: string; embedding: number[] }> } | null> {
  const chunkTexts = chunkText(text)
  const chunks: Array<{ text: string; embedding: number[] }> = []

  for (const chunkTextValue of chunkTexts) {
    const embedding = await embedOne(chunkTextValue)
    if (!embedding) return null
    chunks.push({ text: chunkTextValue, embedding })
  }

  if (chunks.length === 0) return null

  return { pooled: poolChunkEmbeddings(chunks.map((c) => c.embedding)), chunks }
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
 * existing "no provider available" contract — callers already handle a null
 * return by falling through to the next provider or returning null overall.
 */
// Upper bound on cumulative 429 backoff. generateEmbedding runs on the
// synchronous recall READ hot path (tools/recall.ts awaits it), so an
// unbounded `Retry-After` (e.g. 60s) would hang recall for minutes instead of
// failing fast to trigram. Cap the total time we're willing to spend sleeping
// on retries across all attempts to a couple of seconds; once it's spent, stop
// retrying and return null so recall falls through immediately.
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
    console.error(`[embeddings] ${providerLabel} request failed with status ${res.status}: ${body}`)
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

/**
 * Normalize an embedding to exactly 1536 dimensions (the pgvector column width).
 *
 * Truncating a >1536-dim vector without renormalizing would leave it no longer
 * unit-length, silently corrupting cosine-similarity rankings against every
 * other (correctly-normalized) vector in the index. So truncation is always
 * followed by an L2 renormalization pass.
 */
export function normalizeTo1536(embedding: number[]): number[] {
  if (embedding.length === 1536) return embedding
  if (embedding.length > 1536) {
    const truncated = embedding.slice(0, 1536)
    const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0))
    if (norm === 0) return truncated
    return truncated.map((v) => v / norm)
  }
  // Pad with zeros
  return [...embedding, ...new Array(1536 - embedding.length).fill(0)]
}
