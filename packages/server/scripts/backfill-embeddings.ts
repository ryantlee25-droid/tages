#!/usr/bin/env node
/**
 * Full re-embed of a project's pooled `memories.embedding` vectors.
 *
 * NOT a fill-the-nulls job any more. Every vector already in the table was
 * produced by whatever provider happened to be reachable when the row was
 * written — Ollama's nomic-embed-text (768 dims, zero-padded to 1536) or
 * OpenAI's text-embedding-3-small (1536). Cosine similarity between vectors
 * from different models is meaningless, so once the index standardises on the
 * hosted gte-small path, EVERY pre-existing vector is invalid, not just the
 * NULL ones. The default is therefore "re-embed everything"; skipping rows
 * that already have a vector is now an explicit opt-in (`--only-missing`)
 * kept only for the narrow case of topping up a run that was already known to
 * be gte-small.
 *
 * SCOPE: a single named project, by design (unchanged). There is no default —
 * you must pass --project explicitly.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts --project <slug> --dry-run
 *   npx tsx scripts/backfill-embeddings.ts --project <slug>
 *   npx tsx scripts/backfill-embeddings.ts --project <slug> --restart
 *   npx tsx scripts/backfill-embeddings.ts --project <slug> --only-missing
 *
 * Auth precedence (matches packages/cli/src/auth/session.ts):
 *   1. TAGES_SERVICE_KEY env var — service role key, bypasses RLS
 *   2. ~/.config/tages/auth.json — user JWT saved by `tages init`
 *   3. Falls back to the project's anon key (will fail on RLS-protected rows)
 *
 * TAGES_SERVICE_KEY does double duty: `resolveHostedConfig` (embeddings.ts)
 * falls back to it for the edge function's Authorization header, because a
 * service-role Supabase client has no user session to draw a JWT from. The
 * edge function recognises service-role callers explicitly, so this
 * authenticates — verified live against dev, not assumed.
 *
 * Never logs memory plaintext or ciphertext — only ids and error messages.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseClient } from '@tages/shared'
import {
  generateEmbedding,
  generateHostedEmbeddingsBatch,
  resolveEmbeddingProvider,
  HOSTED_MAX_BATCH,
  HOSTED_CHUNK_TARGET_CHARS,
  HOSTED_CHUNK_OVERLAP_CHARS,
} from '../src/embeddings'
import { chunkText } from '../src/chunking'
import { getEncryptionKey, decryptValue } from '../src/crypto/encryption'
import { embeddingToPgVector } from '../src/sync/supabase-sync'

interface CliOptions {
  project: string
  dryRun: boolean
  pageSize: number
  onlyMissing: boolean
  restart: boolean
  since: string | null
  retries: number
}

interface MemoryRow {
  id: string
  value: string
  encrypted: boolean
}

export interface BackfillResult {
  /** Rows in scope for this project (ALL rows, unless --only-missing). */
  total: number
  /** Rows skipped because a checkpoint said a previous run already did them. */
  resumedPast: number
  processed: number
  updated: number
  failed: number
  dryRun: boolean
  /** Dry run only — estimated hosted round trips, see `estimateHostedCalls`. */
  estimatedCalls: number
  /** Highest id for which every row at or below it succeeded this run. */
  watermark: string | null
}

/**
 * Durable progress marker for a resumable run.
 *
 * Injectable so unit tests exercise resume/restart semantics without touching
 * the filesystem; `createFileCheckpoint` is the production implementation.
 */
export interface BackfillCheckpoint {
  load(): string | null
  save(lastCompletedId: string): void
  clear(): void
}

/** A checkpoint that remembers nothing — the default when none is supplied. */
export function createNullCheckpoint(): BackfillCheckpoint {
  return { load: () => null, save: () => {}, clear: () => {} }
}

/**
 * File-backed checkpoint under ~/.config/tages/backfill-state/.
 *
 * Keyed by table AND project so the pooled-embedding run and the chunk run
 * (and two different projects) never clobber each other's cursor.
 */
export function createFileCheckpoint(table: string, projectId: string): BackfillCheckpoint {
  const dir = path.join(os.homedir(), '.config', 'tages', 'backfill-state')
  const file = path.join(dir, `${table}-${projectId}.json`)
  return {
    load(): string | null {
      try {
        if (!fs.existsSync(file)) return null
        const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { lastCompletedId?: string }
        return parsed.lastCompletedId || null
      } catch {
        // A corrupt checkpoint must not wedge the run. Starting over is
        // always correct here (every write is idempotent), just slower.
        return null
      }
    },
    save(lastCompletedId: string): void {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        file,
        JSON.stringify({ table, projectId, lastCompletedId, updatedAt: new Date().toISOString() }, null, 2),
      )
    },
    clear(): void {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      } catch {
        // Best effort — a stale checkpoint after a clean finish only costs a
        // redundant resume prompt on the next run.
      }
    },
  }
}

/**
 * Highest id such that EVERY row at or below it in `orderedIds` succeeded.
 *
 * This is the whole of the resumability guarantee, so it is a pure function
 * with its own tests. Advancing the checkpoint to "last row attempted" would
 * silently strand a failed row: the next run would start past it and the row
 * would keep its stale-model vector forever, invisibly. Stopping the watermark
 * at the first failure means a restart re-attempts that row (and redoes the
 * handful of rows after it, which is free — every write here is idempotent).
 */
export function computeWatermark(orderedIds: string[], succeeded: Set<string>): string | null {
  let watermark: string | null = null
  for (const id of orderedIds) {
    if (!succeeded.has(id)) break
    watermark = id
  }
  return watermark
}

/**
 * Estimated hosted round trips for a set of plaintexts.
 *
 * Rows at or under the gte-small chunk ceiling ride together in batches of
 * `HOSTED_MAX_BATCH`; longer rows are chunked and each row's chunks are sent
 * as their own batched call (see the partition in `embedPage`). Exported so
 * `--dry-run` can print a wall-clock estimate rather than a row count that
 * makes a multi-minute job look instant.
 */
export function estimateHostedCalls(plaintexts: string[]): number {
  const short = plaintexts.filter((t) => t.length <= HOSTED_CHUNK_TARGET_CHARS)
  const long = plaintexts.filter((t) => t.length > HOSTED_CHUNK_TARGET_CHARS)
  let calls = Math.ceil(short.length / HOSTED_MAX_BATCH)
  for (const text of long) {
    const chunks = chunkText(text, {
      chunkSizeChars: HOSTED_CHUNK_TARGET_CHARS,
      overlapChars: HOSTED_CHUNK_OVERLAP_CHARS,
    })
    calls += Math.ceil(chunks.length / HOSTED_MAX_BATCH)
  }
  return calls
}

/** Human-readable duration for progress/ETA lines. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * One progress line: absolute counts, percent, rate, and ETA.
 *
 * At 8 texts per hosted call and ~1.7s per call, a few hundred memories is
 * minutes of wall time. Without a rate and an ETA a correct run is
 * indistinguishable from a hung one, so this is load-bearing, not decoration.
 */
export function formatProgressLine(args: {
  done: number
  total: number
  updated: number
  failed: number
  elapsedMs: number
}): string {
  const { done, total, updated, failed, elapsedMs } = args
  const pct = total > 0 ? Math.round((done / total) * 100) : 100
  const rate = elapsedMs > 0 ? done / (elapsedMs / 1000) : 0
  const remaining = Math.max(0, total - done)
  const etaMs = rate > 0 ? (remaining / rate) * 1000 : Number.POSITIVE_INFINITY
  return (
    `${done}/${total} rows (${pct}%) · ${updated} updated · ${failed} failed · ` +
    `${rate.toFixed(2)} rows/s · elapsed ${formatDuration(elapsedMs)} · ETA ${remaining === 0 ? '0s' : formatDuration(etaMs)}`
  )
}

export interface BackfillOptions {
  dryRun?: boolean
  /** Rows fetched per keyset page. Not the hosted batch size (that is fixed). */
  pageSize?: number
  /** Opt back in to the legacy "only rows with embedding IS NULL" behaviour. */
  onlyMissing?: boolean
  checkpoint?: BackfillCheckpoint
  /** Start strictly after this id, overriding any stored checkpoint. */
  since?: string | null
  /** Cooperative cancellation — checked between pages (SIGINT in main()). */
  shouldStop?: () => boolean
  log?: (line: string) => void
  /** Extra attempts per row when the endpoint returns no vector. */
  retries?: number
  /** Base linear backoff between retries. 0 in tests to keep them timer-free. */
  retryBackoffMs?: number
}

/**
 * Core backfill logic, exported for unit testing with a mocked Supabase client.
 *
 * Paging is KEYSET on `id` (`.order('id').gt('id', cursor).limit(n)`), not
 * offset. Two reasons, both load-bearing:
 *   1. Offset paging over a set being concurrently written can skip or repeat
 *      rows; keyset paging on an immutable primary key cannot.
 *   2. There is no `embedding_model` column (deliberately deferred), so a row
 *      cannot say whether it has already been re-embedded this run. A stable
 *      total order over an immutable key is the only thing left that a
 *      persisted cursor can mean, which is exactly what makes the run
 *      resumable.
 *
 * Resumability contract: after each page, the checkpoint stores the watermark
 * (see `computeWatermark`) — the highest id below which nothing failed. A
 * crash or SIGINT therefore costs at most one page of redone work, and no row
 * is ever skipped because an earlier row failed.
 */
export async function backfillEmbeddings(
  supabase: SupabaseClient,
  projectId: string,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const pageSize = options.pageSize ?? 50
  const checkpoint = options.checkpoint ?? createNullCheckpoint()
  const log = options.log ?? ((line: string) => console.error(`[backfill] ${line}`))
  const encKey = getEncryptionKey()
  const provider = resolveEmbeddingProvider()

  const result: BackfillResult = {
    total: 0,
    resumedPast: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    dryRun: !!options.dryRun,
    estimatedCalls: 0,
    watermark: null,
  }

  const scoped = () => {
    const q = supabase.from('memories').select('*', { count: 'exact', head: true }).eq('project_id', projectId)
    return options.onlyMissing ? q.is('embedding', null) : q
  }

  const { count, error: countError } = await scoped()
  if (countError) throw new Error(`Count query failed: ${countError.message}`)
  result.total = count ?? 0

  if (options.dryRun) {
    // A dry run reads the values it would embed so the estimate reflects the
    // real chunk count, not a row count. Nothing is written.
    const plaintexts: string[] = []
    let cursor: string | null = null
    for (;;) {
      const page = await fetchPage(supabase, projectId, cursor, pageSize, options.onlyMissing)
      if (page.length === 0) break
      for (const row of page) {
        const plaintext = decryptRow(row, encKey, log)
        if (plaintext !== null) plaintexts.push(plaintext)
      }
      cursor = page[page.length - 1].id
    }
    result.estimatedCalls = provider === 'hosted' ? estimateHostedCalls(plaintexts) : plaintexts.length
    return result
  }

  let cursor: string | null = options.since ?? checkpoint.load()
  if (cursor) {
    const { count: doneCount, error: doneError } = await (() => {
      const q = supabase
        .from('memories')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .lte('id', cursor as string)
      return options.onlyMissing ? q.is('embedding', null) : q
    })()
    if (doneError) throw new Error(`Resume count query failed: ${doneError.message}`)
    result.resumedPast = doneCount ?? 0
    result.watermark = cursor
    log(`Resuming after id ${cursor} — ${result.resumedPast}/${result.total} rows already done by a previous run.`)
  }

  const startedAt = Date.now()
  // Once ANY row has failed, the checkpoint must stop advancing for the rest
  // of the run — see the freeze below.
  let watermarkFrozen = false

  for (;;) {
    if (options.shouldStop?.()) {
      log('Stop requested — checkpoint saved, exiting cleanly. Re-run to resume.')
      break
    }

    const page = await fetchPage(supabase, projectId, cursor, pageSize, options.onlyMissing)
    if (page.length === 0) break

    const plaintexts = new Map<string, string>()
    const undecryptable: string[] = []
    for (const row of page) {
      const plaintext = decryptRow(row, encKey, log)
      if (plaintext === null) undecryptable.push(row.id)
      else plaintexts.set(row.id, plaintext)
    }

    const embeddings = await embedPage(
      plaintexts,
      provider,
      { supabaseClient: supabase, projectId },
      options.retries ?? DEFAULT_RETRIES,
      options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
    )

    const succeeded = new Set<string>()
    for (const row of page) {
      result.processed++
      if (undecryptable.includes(row.id)) {
        result.failed++
        continue
      }
      const embedding = embeddings.get(row.id)
      if (!embedding) {
        log(`Skipping ${row.id}: no embedding produced`)
        result.failed++
        continue
      }
      const { error: updateError } = await supabase
        .from('memories')
        .update({ embedding: embeddingToPgVector(embedding) })
        .eq('id', row.id)
      if (updateError) {
        log(`Failed to update ${row.id}: ${updateError.message}`)
        result.failed++
        continue
      }
      result.updated++
      succeeded.add(row.id)
    }

    // The watermark is a RUN-level high-water mark, not a per-page one. Saving
    // each page's own watermark independently would let a later page's higher
    // value overwrite an earlier page's lower one, stepping the cursor straight
    // over a row that failed in an earlier page — it would keep its stale-model
    // vector forever and never be retried. Caught on a live dev run, where a
    // page-1 failure was masked by page 2's checkpoint save.
    if (!watermarkFrozen) {
      const pageWatermark = computeWatermark(
        page.map((r) => r.id),
        succeeded,
      )
      if (pageWatermark) {
        result.watermark = pageWatermark
        checkpoint.save(pageWatermark)
      }
      if (succeeded.size < page.length) watermarkFrozen = true
    }

    // The cursor advances past the whole page even when some rows failed, so
    // the run makes forward progress instead of retrying a permanently bad row
    // forever. The checkpoint stays pinned at the watermark, so those failures
    // are re-attempted on the next run rather than lost.
    cursor = page[page.length - 1].id

    log(
      formatProgressLine({
        done: result.resumedPast + result.processed,
        total: result.total,
        updated: result.updated,
        failed: result.failed,
        elapsedMs: Date.now() - startedAt,
      }),
    )
  }

  const allDone = result.resumedPast + result.processed >= result.total && result.failed === 0
  if (allDone) checkpoint.clear()

  return result
}

/** One keyset page of memories, ordered by the immutable primary key. */
async function fetchPage(
  supabase: SupabaseClient,
  projectId: string,
  cursor: string | null,
  pageSize: number,
  onlyMissing?: boolean,
): Promise<MemoryRow[]> {
  let query = supabase
    .from('memories')
    .select('id, value, encrypted')
    .eq('project_id', projectId)
    .order('id', { ascending: true })
    .limit(pageSize)
  if (onlyMissing) query = query.is('embedding', null)
  if (cursor) query = query.gt('id', cursor)

  const { data, error } = await query
  if (error) throw new Error(`Query failed: ${error.message}`)
  return (data ?? []) as MemoryRow[]
}

function decryptRow(row: MemoryRow, encKey: string | null, log: (line: string) => void): string | null {
  if (!row.encrypted) return row.value
  if (!encKey) {
    log(`Skipping ${row.id}: encrypted but TAGES_ENCRYPTION_KEY is not set`)
    return null
  }
  try {
    return decryptValue(row.value, encKey)
  } catch (err) {
    log(`Skipping ${row.id}: decrypt failed: ${(err as Error).message}`)
    return null
  }
}

/**
 * Embed one page, partitioned by what the hosted endpoint can actually do in
 * a single shot.
 *
 * The partition is a correctness requirement, not an optimisation.
 * `generateHostedEmbeddingsBatch` does NO chunking — it posts the texts it is
 * given. gte-small truncates silently at its context limit and still returns
 * HTTP 200, so handing it a 10KB memory produces a confident, well-formed
 * vector for the first ~800 characters and drops the rest with nothing to
 * observe. So:
 *   - rows at or under HOSTED_CHUNK_TARGET_CHARS are batched together, which
 *     is where the batching win actually lives (8 rows per round trip);
 *   - longer rows go through `generateEmbedding`, which chunks at the hosted
 *     size and mean-pools via the module's own tested path (itself batching
 *     each row's chunks into HOSTED_MAX_BATCH-sized calls).
 *
 * Reimplementing chunk+pool here to flatten chunks across rows into one global
 * batch would squeeze out more throughput, but it would duplicate the pooling
 * and degenerate-norm guard that `embeddings.ts` already owns and tests — the
 * exact drift this release exists to eliminate. Not worth it at these row
 * counts.
 *
 * A failed batch falls back to per-row embedding for that slice so one bad
 * text costs one row rather than eight (`generateHostedEmbeddingsBatch` is
 * fail-closed for the whole array it is given).
 */
async function embedPage(
  plaintexts: Map<string, string>,
  provider: string,
  opts: { supabaseClient: SupabaseClient; projectId: string },
  retries = DEFAULT_RETRIES,
  backoffMs = DEFAULT_RETRY_BACKOFF_MS,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const entries = [...plaintexts.entries()]

  if (provider !== 'hosted') {
    // Explicit --provider ollama/openai override: one row at a time, exactly
    // as before. generateHostedEmbeddingsBatch must never be reached here.
    for (const [id, text] of entries) {
      const embedding = await embedWithRetry(text, opts, retries, backoffMs)
      if (embedding) out.set(id, embedding)
    }
    return out
  }

  const short = entries.filter(([, t]) => t.length <= HOSTED_CHUNK_TARGET_CHARS)
  const long = entries.filter(([, t]) => t.length > HOSTED_CHUNK_TARGET_CHARS)

  for (let i = 0; i < short.length; i += HOSTED_MAX_BATCH) {
    const slice = short.slice(i, i + HOSTED_MAX_BATCH)
    const embeddings = await generateHostedEmbeddingsBatch(
      slice.map(([, t]) => t),
      opts,
    )
    if (embeddings && embeddings.length === slice.length) {
      slice.forEach(([id], idx) => out.set(id, embeddings[idx]))
      continue
    }
    for (const [id, text] of slice) {
      const embedding = await embedWithRetry(text, opts, retries, backoffMs)
      if (embedding) out.set(id, embedding)
    }
  }

  for (const [id, text] of long) {
    const embedding = await embedWithRetry(text, opts, retries, backoffMs)
    if (embedding) out.set(id, embedding)
  }

  return out
}

/** Extra attempts per row before giving up. See `embedWithRetry`. */
export const DEFAULT_RETRIES = 2

/** Base linear backoff between retries. Tests pass 0 to stay timer-free. */
export const DEFAULT_RETRY_BACKOFF_MS = 500

/**
 * `generateEmbedding` with bounded retries and linear backoff.
 *
 * The edge function returns HTTP 546 WORKER_RESOURCE_LIMIT under memory
 * pressure — observed live on dev while re-embedding long memories, where a
 * full batch of 800-char chunks is a much heavier request than the short-text
 * batches HOSTED_MAX_BATCH was measured against. It is a resource condition,
 * not a property of the input, so the same row usually succeeds on a second
 * attempt. `fetchEmbeddingJson`'s own retry logic only covers 429, so 546 has
 * to be handled here.
 *
 * Retrying the whole row (rather than the failing sub-batch) is deliberate:
 * the sub-batching lives inside embeddings.ts, and a pooled vector is only
 * valid if every one of its chunks embedded in the same pass.
 */
async function embedWithRetry(
  text: string,
  opts: { supabaseClient: SupabaseClient; projectId: string },
  retries: number,
  backoffMs: number = DEFAULT_RETRY_BACKOFF_MS,
): Promise<number[] | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const embedding = await generateEmbedding(text, opts)
    if (embedding) return embedding
    if (attempt < retries && backoffMs > 0) await sleep(backoffMs * (attempt + 1))
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv: string[]): CliOptions {
  let project = ''
  let dryRun = false
  let pageSize = 50
  let onlyMissing = false
  let restart = false
  let since: string | null = null
  let retries = DEFAULT_RETRIES

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--project') project = argv[++i] || ''
    else if (arg === '--dry-run') dryRun = true
    // --batch-size is kept as an alias so existing runbooks keep working; it
    // sizes the DB page, never the hosted batch (fixed at HOSTED_MAX_BATCH).
    else if (arg === '--page-size' || arg === '--batch-size') pageSize = parseInt(argv[++i] || '50', 10)
    else if (arg === '--only-missing') onlyMissing = true
    else if (arg === '--restart') restart = true
    else if (arg === '--since') since = argv[++i] || null
    else if (arg === '--retries') retries = parseInt(argv[++i] || String(DEFAULT_RETRIES), 10)
  }

  if (!project) {
    throw new Error(
      'Usage: backfill-embeddings.ts --project <slug> [--dry-run] [--page-size N] [--only-missing] [--restart] [--since <id>] [--retries N]\n\n' +
        'This script is intentionally scoped to a single named project. ' +
        'There is no default — pass --project explicitly.\n\n' +
        'Default behaviour is a FULL re-embed of every memory in the project. ' +
        'Pass --only-missing for the legacy embedding-IS-NULL-only behaviour.',
    )
  }

  return { project, dryRun, pageSize, onlyMissing, restart, since, retries }
}

async function buildAuthenticatedClient(supabaseUrl: string, supabaseAnonKey: string): Promise<SupabaseClient> {
  const serviceKey = process.env.TAGES_SERVICE_KEY
  if (serviceKey) {
    return createSupabaseClient(supabaseUrl, serviceKey)
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)
  const authPath = path.join(os.homedir(), '.config', 'tages', 'auth.json')
  if (fs.existsSync(authPath)) {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    if (auth.accessToken && auth.refreshToken) {
      await supabase.auth.setSession({
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
      })
    }
  }
  return supabase
}

/** Shared by both backfill scripts — resolve a project slug to its config. */
export function loadProjectConfig(slug: string): {
  projectId: string
  supabaseUrl: string
  supabaseAnonKey: string
} {
  const projectConfigPath = path.join(os.homedir(), '.config', 'tages', 'projects', `${slug}.json`)
  if (!fs.existsSync(projectConfigPath)) {
    throw new Error(`No project config found for slug "${slug}" at ${projectConfigPath}`)
  }
  return JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'))
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const projectConfig = loadProjectConfig(options.project)
  const provider = resolveEmbeddingProvider()

  console.error(`[backfill] Scope: project "${options.project}" (${projectConfig.projectId}) only.`)
  console.error(
    `[backfill] Mode: ${options.onlyMissing ? 'ONLY rows with embedding IS NULL (legacy)' : 'FULL re-embed of every memory'} · provider=${provider}`,
  )

  const supabase = await buildAuthenticatedClient(projectConfig.supabaseUrl, projectConfig.supabaseAnonKey)
  const checkpoint = createFileCheckpoint('memories', projectConfig.projectId)

  if (options.dryRun) {
    const result = await backfillEmbeddings(supabase, projectConfig.projectId, {
      dryRun: true,
      pageSize: options.pageSize,
      onlyMissing: options.onlyMissing,
    })
    console.log(`[backfill] Dry run: ${result.total} memories in scope — all of them would be re-embedded.`)
    console.log(
      `[backfill] Estimated ${result.estimatedCalls} hosted round trips ` +
        `(${HOSTED_MAX_BATCH} texts per call), roughly ${formatDuration(result.estimatedCalls * 1700)} of wall time at ~1.7s/call.`,
    )
    const pending = checkpoint.load()
    if (pending) console.log(`[backfill] A checkpoint exists at id ${pending} — a real run would resume after it (--restart to ignore).`)
    console.log('[backfill] Nothing was written.')
    return
  }

  if (options.restart) {
    checkpoint.clear()
    console.error('[backfill] --restart: cleared any stored checkpoint, starting from the beginning.')
  }

  let stop = false
  const onSignal = () => {
    if (stop) process.exit(130)
    stop = true
    console.error('[backfill] Interrupt received — finishing the current page, then saving the checkpoint. Ctrl-C again to abort now.')
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const result = await backfillEmbeddings(supabase, projectConfig.projectId, {
    pageSize: options.pageSize,
    onlyMissing: options.onlyMissing,
    checkpoint,
    since: options.since,
    retries: options.retries,
    shouldStop: () => stop,
  })

  console.log(
    `[backfill] Done. total=${result.total} resumedPast=${result.resumedPast} processed=${result.processed} ` +
      `updated=${result.updated} failed=${result.failed}`,
  )
  if (result.failed > 0) {
    console.log(`[backfill] ${result.failed} rows failed — re-run to retry them (checkpoint held at ${result.watermark ?? 'the start'}).`)
    process.exitCode = 1
  }
}

// Only run when invoked directly (e.g. via `tsx scripts/backfill-embeddings.ts`),
// not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill] Fatal error:', (err as Error).message)
    process.exit(1)
  })
}
