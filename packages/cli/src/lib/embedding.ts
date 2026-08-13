/**
 * CLI-local embedding generation for semantic recall.
 *
 * Mirrors packages/server/src/embeddings.ts's provider selection and 1536-dim
 * normalization. Deliberately NOT imported from @tages/server: a runtime
 * dependency on the server package would break `npm install -g @tages/cli`
 * standalone installs. Keep this file in sync with the server's copy BY HAND
 * if provider precedence, fallthrough behavior, or normalization changes.
 *
 * ---------------------------------------------------------------------------
 * PROVIDER SELECTION (PLAN-HOSTED-EMBEDDING.md Task 3 — mirror of Task 2)
 * ---------------------------------------------------------------------------
 *
 *   TAGES_EMBED_PROVIDER = hosted (default) | ollama | openai
 *
 * Resolved ONCE per process and memoized, then `embedOne` `switch`es on it:
 * exactly one branch runs per call, with NO fallthrough to a different
 * provider. That structural guarantee is the whole point.
 *
 * The bug this replaces was live, not hypothetical: `embedOne` previously
 * called `embedViaOllama(text)` UNCONDITIONALLY on every call, gated by
 * nothing — only the OpenAI leg sat behind TAGES_OPENAI_EMBED. So two
 * teammates already wrote vectors from different models into one index purely
 * because one of them happened to have Ollama running for an unrelated
 * project. Cosine similarity across models is meaningless, so the index
 * returned confident nonsense with nothing anywhere surfacing an error.
 *
 * `embedViaOllama` and `embedSingleChunkViaOpenAI` are UNCHANGED internally
 * (same fetch calls, same retry/429 handling, same normalization). They simply
 * become unreachable unless a team explicitly opts the whole team out of
 * hosted — an all-or-nothing decision, because a half-migrated team is exactly
 * the mixed-vector-space state above.
 *
 * Precedence, in order (identical to the server copy):
 *   1. TAGES_EMBED_PROVIDER, when set to a recognized value.
 *   2. TAGES_OPENAI_EMBED=1 — backward-compatible alias for `openai`, honored
 *      ONLY when TAGES_EMBED_PROVIDER is unset, with a deprecation warning.
 *   3. hosted (the default).
 * An unrecognized TAGES_EMBED_PROVIDER value warns and falls back to hosted,
 * never to a local probe.
 *
 * `generateEmbedding`'s failure contract is UNCHANGED: any provider failing
 * (hosted timeout, hosted 5xx, Ollama down, no OpenAI key, hosted not
 * configured) returns null, never throws. recall.ts already treats null as
 * "skip semantic search, fall through to trigram"; that path is untouched.
 *
 * TODO (removes the one-provider-per-index restriction entirely): record the
 * embedding model on each memory row (e.g. an `embedding_model` column) and
 * only run semantic recall when the query can be embedded with that same
 * model, falling back to trigram per-row otherwise. The process-wide switch
 * here is the conservative version that avoids a schema change while still
 * guaranteeing query and documents share a vector space.
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
 *
 * Multi-vector chunk storage (Task 9, Phase 2): `generateChunkEmbeddings`
 * below mirrors the server's copy (packages/server/src/embeddings.ts) — a
 * separate entry point from `generateEmbedding` for the per-chunk
 * `memory_chunks` table. Per chunk it goes through the SAME `embedOne`
 * provider switch as `generateEmbedding`, so chunk vectors, the pooled vector,
 * and the query vector are always produced by one provider and comparable in
 * one vector space. `generateEmbedding()`'s external behavior is unchanged.
 */

import { chunkText, estimateTokenCount, SAFE_SINGLE_CALL_TOKEN_LIMIT } from './chunking.js'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'

/**
 * THE hosted chunk size. gte-small is a compact BERT-family encoder whose real
 * input ceiling is far below OpenAI's 8192 tokens (typically ~512), so the
 * OpenAI-sized `CHUNK_TARGET_CHARS = 4000` in chunking.ts must NOT be reused
 * for the hosted path.
 *
 * 1500 is a deliberately conservative PLACEHOLDER (PLAN-HOSTED-EMBEDDING.md
 * Open Question 2). Task 1 is empirically probing gte-small's actual limit
 * against the live dev endpoint. Both constants live here, in one clearly
 * named place, precisely so adopting that number is a one-line change and
 * cannot drift across the call sites that consume it.
 *
 * Hand-synced with packages/server/src/embeddings.ts — same names, same
 * values.
 */
export const HOSTED_CHUNK_TARGET_CHARS = 1500
export const HOSTED_CHUNK_OVERLAP_CHARS = 225 // 15% of HOSTED_CHUNK_TARGET_CHARS

/** Max `texts[]` per hosted call — matches the edge function's own cap. */
const HOSTED_MAX_BATCH = 128

const HOSTED_TIMEOUT_MS = 10000
const HOSTED_BATCH_TIMEOUT_MS = 30000

export type EmbeddingProvider = 'hosted' | 'ollama' | 'openai'

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
 * `embeddingProvidersUsedThisProcess().length <= 1`.
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
      `[embedding] Unrecognized TAGES_EMBED_PROVIDER="${process.env.TAGES_EMBED_PROVIDER}" ` +
        `(expected hosted|ollama|openai) — using the hosted default.`,
    )
    return 'hosted'
  }
  if (process.env.TAGES_OPENAI_EMBED === '1') {
    console.error(
      '[embedding] TAGES_OPENAI_EMBED is deprecated — use TAGES_EMBED_PROVIDER=openai. ' +
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

export interface GenerateEmbeddingOptions {
  /**
   * CLI-only kill switch (the server copy has no equivalent). Pass `false` and
   * the openai provider returns null without calling out, for callers that
   * must never make a paid request whatever the environment says.
   *
   * It no longer doubles as the enable gate: selecting openai — via
   * TAGES_EMBED_PROVIDER=openai or the legacy TAGES_OPENAI_EMBED alias — is
   * now the whole opt-in, matching the server, which gates only on
   * OPENAI_API_KEY. It does NOT redirect to another provider: a disabled
   * openai provider returns null, like any unavailable provider.
   */
  allowOpenAIFallback?: boolean
  /**
   * Supabase project URL, from the CLI's project config. The server copy reads
   * this off its threaded SupabaseClient instead; the CLI passes it explicitly
   * so lib/embedding.ts keeps no @supabase/supabase-js dependency.
   */
  supabaseUrl?: string
  /**
   * The signed-in user's JWT, resolved by the calling command. Same position
   * in the precedence chain as the server's `supabaseClient.auth.getSession()`
   * lookup: tried first, then the env key chain in resolveHostedConfig.
   */
  accessToken?: string
  /** Project id for the endpoint's membership check. */
  projectId?: string
}

export async function generateEmbedding(
  text: string,
  opts: GenerateEmbeddingOptions = {},
): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider()

  // Long-text handling is per-provider, but it is still only ever ONE
  // provider: each branch chunks (at its own model's safe size) and pools with
  // the shared `poolChunkEmbeddings`, and none of them falls through to
  // another provider on failure.
  //
  // This switch is load-bearing, not cosmetic. The old code opened this
  // function with `if (openaiKey && estimateTokenCount(text) > LIMIT) { const
  // ollama = await embedViaOllama(text); if (ollama) return ollama; ... }` —
  // an unconditional Ollama probe on the long-text path. Porting only
  // `embedOne` and leaving that preamble would keep the mixed-vector-space bug
  // alive in the one code path nobody reads.
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
      if (
        openaiKey &&
        opts.allowOpenAIFallback !== false &&
        estimateTokenCount(text) > SAFE_SINGLE_CALL_TOKEN_LIMIT
      ) {
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
 * Returns null (never throws) when Ollama is unavailable.
 */
async function embedViaOllama(text: string): Promise<number[] | null> {
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
 * embedding write and a backfill can retry later) rather than escalating to a
 * different model and poisoning the index with a second vector space. Adding
 * an `||` or a `catch`-and-try-the-next-provider here would reintroduce
 * exactly the bug this switch replaced.
 */
async function embedOne(text: string, opts: GenerateEmbeddingOptions = {}): Promise<number[] | null> {
  const provider = resolveEmbeddingProvider()
  providersUsed.add(provider)

  switch (provider) {
    case 'hosted':
      return await embedViaHosted(text, opts)
    case 'ollama':
      return await embedViaOllama(text)
    case 'openai': {
      const openaiKey = process.env.OPENAI_API_KEY
      // `allowOpenAIFallback === false` is the CLI-only kill switch; the
      // server copy has only the key check.
      if (!openaiKey || opts.allowOpenAIFallback === false) return null
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
 * The warning is emitted once per process: recall calls this on every query,
 * so a per-call log would be a firehose.
 *
 * Precedence is hand-synced with the server copy. The CLI's `opts.accessToken`
 * occupies the slot the server fills from `supabaseClient.auth.getSession()`;
 * the env chain below it is identical.
 */
let warnedHostedConfig = false

function resolveHostedConfig(
  opts: GenerateEmbeddingOptions,
): { url: string; token: string; projectId: string | undefined } | null {
  const explicitUrl = process.env.TAGES_EMBED_URL
  const baseUrl = process.env.SUPABASE_URL || opts.supabaseUrl
  const url = explicitUrl || (baseUrl ? `${baseUrl.replace(/\/+$/, '')}/functions/v1/embed` : undefined)

  const token =
    opts.accessToken ||
    process.env.TAGES_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY

  if (!url || !token) {
    if (!warnedHostedConfig) {
      warnedHostedConfig = true
      console.error(
        '[embedding] Hosted embedding is selected but not configured ' +
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
 * ("Technical Approach") and hand-mirrored from packages/server/src/
 * embeddings.ts — do not change it on one side only.
 */
async function postHostedEmbed(
  texts: string[],
  opts: GenerateEmbeddingOptions,
  timeoutMs: number,
): Promise<number[][] | null> {
  const cfg = resolveHostedConfig(opts)
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
async function embedViaHosted(
  text: string,
  opts: GenerateEmbeddingOptions,
): Promise<number[] | null> {
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
  opts: GenerateEmbeddingOptions,
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
 * Splits into sub-batches of `HOSTED_MAX_BATCH` because the edge function
 * rejects more than 128 texts per call. Fail-closed: returns `null` if ANY
 * sub-batch fails, rather than a partially-embedded array a caller could
 * mistake for a complete one.
 *
 * Hosted-specific by design — it is the batching endpoint, not a
 * provider-selection entry point, so it never consults
 * `resolveEmbeddingProvider`. (The server exports its copy for the backfill
 * scripts; the CLI has no backfill, so this stays module-private.)
 */
async function generateHostedEmbeddingsBatch(
  texts: string[],
  opts: GenerateEmbeddingOptions = {},
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
 * rather than silently pooling a subset.
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
      body: JSON.stringify({ model: 'text-embedding-3-small', input: chunk }),
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
 * Same provider selection as generateEmbedding: each chunk goes through
 * `embedOne`, so it uses the process's one resolved provider (hosted by
 * default). Chunk vectors, the pooled vector, and the query vector are
 * therefore always in the same vector space. Returns null (no chunks
 * persisted) when the provider yields no vector.
 *
 * Chunk-row granularity stays at chunking.ts's eval-tuned CHUNK_TARGET_CHARS
 * (4000) regardless of provider, because it determines what a `memory_chunks`
 * row IS. Under hosted, embedViaHosted sub-chunks each of those to
 * HOSTED_CHUNK_TARGET_CHARS and pools — so gte-small's window is respected
 * without changing what gets stored or re-tuning the retrieval eval.
 *
 * Fail-closed for chunk storage (distinct from the pooled path's fail-open
 * contract): if ANY individual chunk fails to embed, the whole result is
 * discarded (returns null) rather than persisting a partial chunk set — the
 * caller (remember.ts) simply skips writing chunk rows this time; the pooled
 * embedding write (a separate, independent call) is entirely unaffected.
 */
export async function generateChunkEmbeddings(
  text: string,
  opts: GenerateEmbeddingOptions = {},
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
