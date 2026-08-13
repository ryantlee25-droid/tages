/**
 * Embedding generation for semantic search.
 *
 * PROVIDER SELECTION IS A DETERMINISTIC SWITCH, NOT A PROBE CHAIN
 * (PLAN-HOSTED-EMBEDDING.md Task 2, finding 1).
 *
 * This module used to try providers "in order": `embedOne` called
 * `embedViaOllama(text)` UNCONDITIONALLY on every call, gated by nothing, and
 * only the OpenAI leg sat behind an env var. That meant two teammates could
 * silently write vectors from DIFFERENT models into one shared index purely
 * because one of them happened to have Ollama running for an unrelated
 * project. Cosine similarity across models is meaningless, so such an index
 * returns confident nonsense. That was live behaviour, not a hypothetical.
 *
 * Now exactly one provider is resolved ONCE per process from
 * `TAGES_EMBED_PROVIDER` (`hosted` (default) | `ollama` | `openai`), and
 * `embedOne` is a switch in which exactly one branch runs with NO FALLTHROUGH
 * to a different provider. A provider failing yields `null` — it never
 * escalates to a different model. `embedViaOllama` and
 * `embedSingleChunkViaOpenAI` are internally unchanged; they simply become
 * unreachable unless explicitly selected. Mixing providers is now a whole-team
 * configuration decision rather than an accident of what happens to be running
 * on someone's laptop.
 *
 * FAILURE CONTRACT (unchanged): `generateEmbedding` returns `null` and never
 * throws, for every provider and every failure mode (hosted timeout, hosted
 * 5xx, Ollama down, no OpenAI key). Both `recall.ts` call sites treat `null`
 * as "skip semantic search, fall back to trigram". A hosted outage therefore
 * degrades to trigram — it never silently switches provider.
 *
 * Uses 1536-dimension embeddings (OpenAI-compatible) for pgvector. Ollama uses
 * nomic-embed-text (768 dims), the hosted endpoint uses gte-small (384 dims);
 * `normalizeTo1536` pads both, so no schema change is involved.
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
 * It reuses `chunkText()` and the SAME resolved provider that
 * generateEmbedding uses, so the query vector and the stored chunk vectors
 * always live in one vector space. (Historically it was OpenAI-only while
 * queries were Ollama-first, so their cosine was meaningless whenever Ollama
 * was running — the same class of bug as the provider probe chain.)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunkText, estimateTokenCount, SAFE_SINGLE_CALL_TOKEN_LIMIT } from './chunking'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

/**
 * THE hosted chunk size. gte-small is a compact BERT-family encoder whose real
 * input ceiling is far below OpenAI's 8192 tokens (typically ~512), so the
 * OpenAI-sized `CHUNK_TARGET_CHARS = 4000` in chunking.ts must NOT be reused
 * for the hosted path.
 *
 * 800 is EMPIRICALLY DERIVED, not a guess. gte-small caps at ~512 tokens and
 * — critically — it does NOT error on longer input. It returns HTTP 200 with a
 * vector bit-identical to the one for the truncated prefix, so oversizing this
 * constant degrades retrieval silently, with nothing to observe. A 32,000-char
 * input measured identical to its first ~2,350 chars.
 *
 * The character budget moves with tokenization density, so the bound must hold
 * for the worst realistic content, not for prose. Measured truncation
 * boundaries (first char offset already discarded):
 *
 *   English prose        2350   (4.59 chars/token)
 *   TypeScript source    1472   (2.87)
 *   stack traces         1466   (2.86)
 *   JSON records w/paths 1107   (2.16)   <-- the realistic worst case
 *   hex digests / UUIDs   712   (1.39)   <-- carries no retrievable meaning
 *
 * 800 sits ~28% under JSON-shaped records. Only pure high-entropy strings
 * truncate above it, and those are not semantically retrievable anyway.
 * `chunkText()` treats this as a hard ceiling and never overshoots.
 */
export const HOSTED_CHUNK_TARGET_CHARS = 800
export const HOSTED_CHUNK_OVERLAP_CHARS = 120 // 15% of HOSTED_CHUNK_TARGET_CHARS

/**
 * Max `texts[]` per hosted call.
 *
 * 8, not the 128 the endpoint advertises — 128 was never achievable. Batches of
 * 16 or more are killed with HTTP 546 (WORKER_LIMIT), reproduced 3/3; the hard
 * ceiling measured 14. Cost is per model invocation rather than per input
 * length (n=8 takes ~1.7s whether the texts are 1 char or 4000), so a smaller
 * batch costs latency, not throughput.
 */
export const HOSTED_MAX_BATCH = 8

const HOSTED_TIMEOUT_MS = 10000
const HOSTED_BATCH_TIMEOUT_MS = 30000

export type EmbeddingProvider = 'hosted' | 'ollama' | 'openai'

/**
 * Context the hosted provider needs to reach the edge function. Optional
 * everywhere, so every existing caller keeps compiling: `recall.ts` and
 * `remember.ts` thread the MCP server's authenticated Supabase client through,
 * while the backfill scripts rely on the env fallbacks in `resolveHostedConfig`.
 */
export interface EmbeddingOptions {
  supabaseClient?: SupabaseClient
  projectId?: string
}

/**
 * The single resolved provider for this process, memoized on first use.
 *
 * Resolving once is the structural half of the fix: a provider that could be
 * re-read per call would let a mid-run env change split one logical write
 * across two vector spaces — exactly the bug this module exists to prevent.
 */
let resolvedProvider: EmbeddingProvider | null = null

/** Providers actually exercised in this process. See the invariant below. */
const providersUsed = new Set<EmbeddingProvider>()

/**
 * Every provider this process has actually embedded with. The invariant that
 * makes uniformity structural rather than conventional is
 * `embeddingProvidersUsedThisProcess().length <= 1` — asserted by
 * `__tests__/mixed-provider-regression.test.ts` after a mixed read/write
 * workload run with all three providers simultaneously available.
 */
export function embeddingProvidersUsedThisProcess(): EmbeddingProvider[] {
  return [...providersUsed]
}

/**
 * Resolve the embedding provider for this process — read once, cached forever.
 *
 * `TAGES_OPENAI_EMBED=1` is honored as a backward-compatible alias for
 * `openai`, but ONLY when `TAGES_EMBED_PROVIDER` is unset, with a one-time
 * deprecation warning. An unrecognized `TAGES_EMBED_PROVIDER` value falls back
 * to the hosted default rather than to a local probe: an unreadable value must
 * never resurrect the ambient-Ollama behaviour this replaced.
 */
export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (resolvedProvider !== null) return resolvedProvider
  resolvedProvider = computeEmbeddingProvider()
  return resolvedProvider
}

function computeEmbeddingProvider(): EmbeddingProvider {
  const raw = process.env.TAGES_EMBED_PROVIDER?.trim().toLowerCase()
  if (raw) {
    if (raw === 'hosted' || raw === 'ollama' || raw === 'openai') return raw
    console.error(
      `[embeddings] Unrecognized TAGES_EMBED_PROVIDER="${process.env.TAGES_EMBED_PROVIDER}" ` +
        `(expected hosted|ollama|openai) — using the hosted default.`,
    )
    return 'hosted'
  }
  if (process.env.TAGES_OPENAI_EMBED === '1') {
    console.error(
      '[embeddings] TAGES_OPENAI_EMBED is deprecated — use TAGES_EMBED_PROVIDER=openai. ' +
        'Honoring it as openai for now.',
    )
    return 'openai'
  }
  return 'hosted'
}

/**
 * Test-only: clear the memoized provider (and the used-provider audit) so each
 * test can exercise a different provider in one vitest process. Never call
 * this from product code — re-resolving mid-run is the exact hazard the
 * once-per-process memo exists to prevent.
 */
export function __resetEmbeddingProviderForTests(): void {
  resolvedProvider = null
  providersUsed.clear()
  warnedHostedConfig = false
}

export async function generateEmbedding(
  text: string,
  opts: EmbeddingOptions = {},
): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider()

  // Long-text handling is per-provider, but it is still only ever ONE
  // provider: each branch chunks (at its own model's safe size) and pools with
  // the shared `poolChunkEmbeddings`, and none of them falls through to
  // another provider on failure.
  switch (provider) {
    case 'hosted':
      // gte-small's ceiling is low enough that the hosted path decides on raw
      // character length rather than the OpenAI-calibrated token estimate.
      if (text.length > HOSTED_CHUNK_TARGET_CHARS) {
        return await embedLongTextViaHosted(text, opts)
      }
      return await embedOne(text, opts)
    case 'openai': {
      const openaiKey = process.env.OPENAI_API_KEY
      if (openaiKey && estimateTokenCount(text) > SAFE_SINGLE_CALL_TOKEN_LIMIT) {
        return await embedLongTextViaOpenAI(text, openaiKey)
      }
      return await embedOne(text, opts)
    }
    case 'ollama':
      // Unchanged: Ollama has always been handed the whole input.
      return await embedOne(text, opts)
  }
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
 * Embed a single text (a query, or ONE already-chunk-sized passage) with the
 * process's ONE resolved provider.
 *
 * This is the single provider-branch point in the module, and the shared
 * helper `generateChunkEmbeddings` uses per chunk — so chunk vectors, pooled
 * vectors and query vectors are always produced by the same model and are
 * comparable in one vector space.
 *
 * Exactly one `case` runs. There is deliberately NO fallthrough: a failing
 * provider returns `null` (recall degrades to trigram, remember skips the
 * embedding write and the backfill can retry later) rather than escalating to
 * a different model and poisoning the index with a second vector space. Adding
 * an `||` or a `catch`-and-try-the-next-provider here would reintroduce
 * exactly the bug this switch replaced.
 */
async function embedOne(text: string, opts: EmbeddingOptions = {}): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider()
  providersUsed.add(provider)

  switch (provider) {
    case 'hosted':
      return await embedViaHosted(text, opts)
    case 'ollama':
      return await embedViaOllama(text)
    case 'openai': {
      const openaiKey = process.env.OPENAI_API_KEY
      if (!openaiKey) return null
      try {
        return await embedSingleChunkViaOpenAI(text, openaiKey)
      } catch {
        // OpenAI not available — null, never another provider.
        return null
      }
    }
  }
}

/**
 * Resolve the hosted endpoint URL, bearer token and project id.
 *
 * Returns `null` (never throws) when the process has no usable hosted config,
 * which propagates as the module's normal "no embedding available" `null`.
 * The warning is emitted once per process: this runs on the recall hot path
 * inside a long-lived MCP server, so a per-call log would be a firehose.
 */
let warnedHostedConfig = false

async function resolveHostedConfig(
  opts: EmbeddingOptions,
): Promise<{ url: string; token: string; projectId: string | undefined } | null> {
  const explicitUrl = process.env.TAGES_EMBED_URL
  // `supabaseUrl` is a protected field on SupabaseClient but is present at
  // runtime; the MCP server builds its client from project config rather than
  // env, so this is the practical source there.
  const baseUrl =
    process.env.SUPABASE_URL ||
    (opts.supabaseClient as unknown as { supabaseUrl?: string } | undefined)?.supabaseUrl
  const url = explicitUrl || (baseUrl ? `${baseUrl.replace(/\/+$/, '')}/functions/v1/embed` : undefined)

  let token: string | undefined
  try {
    const session = await opts.supabaseClient?.auth.getSession()
    token = session?.data?.session?.access_token
  } catch {
    // Session lookup failed — fall through to the service/anon key below.
  }
  token =
    token ||
    process.env.TAGES_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY

  if (!url || !token) {
    if (!warnedHostedConfig) {
      warnedHostedConfig = true
      console.error(
        '[embeddings] Hosted embedding is selected but not configured ' +
          `(${!url ? 'no Supabase URL' : 'no auth token'}) — semantic search will fall back to text search. ` +
          'Set TAGES_EMBED_PROVIDER=ollama|openai to use a local provider instead.',
      )
    }
    return null
  }

  return { url, token, projectId: opts.projectId || process.env.TAGES_PROJECT_ID }
}

/**
 * POST to the hosted embed edge function, reusing `fetchEmbeddingJson` so the
 * hosted path inherits its 429 retry-with-backoff (which already honors
 * `Retry-After`, sent by the edge function's rate limiter) and its
 * read-and-log-every-non-OK-body behaviour.
 *
 * Request/response contract is frozen in PLAN-HOSTED-EMBEDDING.md
 * ("Technical Approach") and hand-mirrored by the CLI copy of this module —
 * do not change it on one side only.
 */
async function postHostedEmbed(
  texts: string[],
  opts: EmbeddingOptions,
  timeoutMs: number,
): Promise<number[][] | null> {
  const cfg = await resolveHostedConfig(opts)
  if (!cfg) return null

  const body: Record<string, unknown> = texts.length === 1 ? { text: texts[0] } : { texts }
  if (cfg.projectId) body.project_id = cfg.projectId

  try {
    const data = (await fetchEmbeddingJson(
      cfg.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.token}`,
        },
        body: JSON.stringify(body),
      },
      'Hosted (tages embed)',
      timeoutMs,
    )) as { embeddings?: number[][] } | null

    const embeddings = data?.embeddings
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null
    // Partial/short results are treated as total failure rather than silently
    // embedding a subset — the same fail-closed stance as the pooled paths.
    if (embeddings.some((e) => !Array.isArray(e) || e.length === 0)) return null
    return embeddings.map((e) => normalizeTo1536(e))
  } catch {
    // Network error / abort — null, never another provider.
    return null
  }
}

/**
 * Embed a single already-chunk-sized text via the hosted edge function,
 * normalized to 1536 dims (gte-small returns 384; normalizeTo1536 zero-pads).
 */
async function embedViaHosted(text: string, opts: EmbeddingOptions): Promise<number[] | null> {
  const result = await postHostedEmbed([text], opts, HOSTED_TIMEOUT_MS)
  return result?.[0] ?? null
}

/**
 * Embed text longer than gte-small can take in one call: chunk at the hosted
 * size, send the chunks as ONE batched `texts[]` request, and mean-pool with
 * the existing `poolChunkEmbeddings`. No new pooling logic — just a smaller
 * chunk size feeding the machinery the OpenAI long-text path already uses.
 */
async function embedLongTextViaHosted(
  text: string,
  opts: EmbeddingOptions,
): Promise<number[] | null> {
  const chunks = chunkText(text, {
    chunkSizeChars: HOSTED_CHUNK_TARGET_CHARS,
    overlapChars: HOSTED_CHUNK_OVERLAP_CHARS,
  })
  const embeddings = await generateHostedEmbeddingsBatch(chunks, opts)
  if (!embeddings || embeddings.length === 0) return null
  return poolChunkEmbeddings(embeddings)
}

/**
 * Embed many texts in as few hosted calls as possible, preserving input order.
 *
 * Exported for the backfill scripts (PLAN-HOSTED-EMBEDDING.md Task 4), which
 * re-embed a whole project and would otherwise pay one ~550ms round trip per
 * row. Splits into sub-batches of `HOSTED_MAX_BATCH` because the edge function
 * rejects more than 128 texts per call.
 *
 * Fail-closed: returns `null` if ANY sub-batch fails, rather than a
 * partially-embedded array a caller could mistake for a complete one. Callers
 * that need per-row resilience should batch smaller and retry.
 *
 * This is hosted-specific by design — it is the batching endpoint, not a
 * provider-selection entry point, so it never consults `resolveEmbeddingProvider`
 * and a caller running under `TAGES_EMBED_PROVIDER=ollama` must not call it.
 */
export async function generateHostedEmbeddingsBatch(
  texts: string[],
  opts: EmbeddingOptions = {},
): Promise<number[][] | null> {
  if (texts.length === 0) return []
  providersUsed.add('hosted')

  const out: number[][] = []
  for (let i = 0; i < texts.length; i += HOSTED_MAX_BATCH) {
    const slice = texts.slice(i, i + HOSTED_MAX_BATCH)
    const embedded = await postHostedEmbed(slice, opts, HOSTED_BATCH_TIMEOUT_MS)
    if (!embedded) return null
    out.push(...embedded)
  }
  return out
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
 * Same provider selection as generateEmbedding: chunks are embedded with the
 * process's ONE resolved provider (via `embedOne`, or one batched hosted call),
 * so chunk vectors, the pooled vector, AND the query vector are always
 * produced by the same provider/model
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
  opts: EmbeddingOptions = {},
): Promise<{ pooled: number[] | null; chunks: Array<{ text: string; embedding: number[] }> } | null> {
  const provider = resolveEmbeddingProvider()

  // Chunk at the selected provider's own safe size. Reusing the OpenAI-sized
  // CHUNK_TARGET_CHARS for hosted would hand gte-small inputs well past its
  // real ceiling — the failure this would produce (truncation or a 400) is the
  // silent-embedding-loss class this module already has scar tissue for.
  const chunkTexts =
    provider === 'hosted'
      ? chunkText(text, {
          chunkSizeChars: HOSTED_CHUNK_TARGET_CHARS,
          overlapChars: HOSTED_CHUNK_OVERLAP_CHARS,
        })
      : chunkText(text)

  let embeddings: Array<number[] | null> | null
  if (provider === 'hosted') {
    // One batched call instead of N sequential round trips. Same provider,
    // same model, same fail-closed semantics as the per-chunk loop below.
    providersUsed.add('hosted')
    embeddings = await generateHostedEmbeddingsBatch(chunkTexts, opts)
  } else {
    const collected: Array<number[] | null> = []
    for (const chunkTextValue of chunkTexts) {
      collected.push(await embedOne(chunkTextValue, opts))
    }
    embeddings = collected
  }

  if (!embeddings || embeddings.length !== chunkTexts.length) return null

  const chunks: Array<{ text: string; embedding: number[] }> = []
  for (let i = 0; i < chunkTexts.length; i++) {
    const embedding = embeddings[i]
    if (!embedding) return null
    chunks.push({ text: chunkTexts[i], embedding })
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

    // 546 is Supabase Edge Runtime's WORKER_RESOURCE_LIMIT: the isolate was
    // killed mid-request. Measured during the dev backfill, it is transient and
    // load-driven, NOT size-driven — a 6,795-char row failed while a 19,985-char
    // row in the same run succeeded, which points at token density rather than
    // payload size. It was previously non-retryable, so a single unlucky
    // sub-batch failed the whole array and the backfill silently left those rows
    // on their stale vectors. Each sub-batch is one fetch, so retrying here IS
    // the per-sub-batch retry. The same bounded budget applies, which keeps the
    // recall read path failing fast to trigram rather than hanging.
    if (
      (res.status === 429 || res.status === 546) &&
      attempt < maxRetries &&
      spentDelayMs < MAX_TOTAL_RETRY_DELAY_MS
    ) {
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
