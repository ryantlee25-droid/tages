#!/usr/bin/env node
/**
 * Full re-embed of a project's per-chunk `memory_chunks` vectors.
 *
 * Companion to backfill-embeddings.ts and, like it, no longer a fill-the-gaps
 * job. Two things changed:
 *
 * 1. The "skip memories that already have chunk rows" check is GONE. Existing
 *    chunk vectors came from whichever provider was reachable when the memory
 *    was written, so they are stale-model, not done. `remoteUpsertChunks`
 *    (supabase-sync.ts) resolves the parent by (project_id, key), deletes every
 *    chunk for that memory, then inserts the new set — re-read and confirmed
 *    for this task rather than taken on trust — so re-running is idempotent per
 *    memory with no new delete logic.
 * 2. The old `plaintext.length > CHUNK_TARGET_CHARS` candidate filter is gone
 *    too. That 4000-char threshold was OpenAI-calibrated, and the write path
 *    (`remember.ts`) calls `generateChunkEmbeddings` unconditionally for every
 *    memory regardless of length. Keeping a 4000-char floor here while the
 *    hosted chunk size is 800 would leave every memory between those two sizes
 *    with no chunk rows at all — present in the write path, absent in the
 *    backfill. Default is now every memory; `--min-chars N` restores a floor.
 *
 * SCOPE: a single named project, by design. There is no default; --project is
 * required. See backfill-embeddings.ts's header for the full rationale.
 *
 * Usage:
 *   npx tsx scripts/backfill-chunk-embeddings.ts --project <slug> --dry-run
 *   npx tsx scripts/backfill-chunk-embeddings.ts --project <slug>
 *   npx tsx scripts/backfill-chunk-embeddings.ts --project <slug> --restart
 *
 * Auth precedence (matches backfill-embeddings.ts / packages/cli/src/auth/session.ts):
 *   1. TAGES_SERVICE_KEY env var — service role key, bypasses RLS
 *   2. ~/.config/tages/auth.json — user JWT saved by `tages init`
 *   3. Falls back to the project's anon key (will fail on RLS-protected rows)
 *
 * Never logs memory plaintext or ciphertext — only ids and error messages.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseClient } from '@tages/shared'
import {
  generateChunkEmbeddings,
  resolveEmbeddingProvider,
  HOSTED_MAX_BATCH,
  HOSTED_CHUNK_TARGET_CHARS,
  HOSTED_CHUNK_OVERLAP_CHARS,
} from '../src/embeddings'
import { chunkText, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS } from '../src/chunking'
import { getEncryptionKey, decryptValue } from '../src/crypto/encryption'
import { SupabaseSync } from '../src/sync/supabase-sync'
import type { SqliteCache } from '../src/cache/sqlite'
import {
  computeWatermark,
  createFileCheckpoint,
  createNullCheckpoint,
  DEFAULT_RETRIES,
  formatDuration,
  formatProgressLine,
  loadProjectConfig,
  type BackfillCheckpoint,
} from './backfill-embeddings'

interface CliOptions {
  project: string
  dryRun: boolean
  pageSize: number
  minChars: number
  restart: boolean
  since: string | null
  retries: number
}

interface MemoryRow {
  id: string
  key: string
  value: string
  encrypted: boolean
}

export interface ChunkBackfillResult {
  /** Memories in scope (all of them, unless --min-chars raises the floor). */
  total: number
  resumedPast: number
  processed: number
  updated: number
  /** Below the --min-chars floor — out of scope, not a failure. */
  belowFloor: number
  failed: number
  dryRun: boolean
  /** Dry run only — chunk rows that would be written. */
  estimatedChunks: number
  estimatedCalls: number
  watermark: string | null
}

export interface ChunkBackfillOptions {
  dryRun?: boolean
  pageSize?: number
  /** Skip memories shorter than this. Default 0 — every memory is in scope. */
  minChars?: number
  checkpoint?: BackfillCheckpoint
  since?: string | null
  shouldStop?: () => boolean
  log?: (line: string) => void
  /** Extra attempts per memory when chunk embedding returns nothing. */
  retries?: number
  /** Injectable for tests; defaults to a real SupabaseSync over `supabase`. */
  sync?: { remoteUpsertChunks: SupabaseSync['remoteUpsertChunks'] }
}

/**
 * Core chunk-backfill logic, exported for unit testing with a mocked Supabase
 * client.
 *
 * Paging is keyset on `id`, identical in shape and rationale to
 * backfill-embeddings.ts — see that file's `backfillEmbeddings` docblock. The
 * old version used offset `.range()` paging specifically because "already
 * chunked" lived in another table and could not be expressed as a filter;
 * dropping the skip check removes that constraint entirely, so this can now
 * use the same stable keyset cursor and the same watermark checkpoint.
 */
export async function backfillChunkEmbeddings(
  supabase: SupabaseClient,
  projectId: string,
  options: ChunkBackfillOptions = {},
): Promise<ChunkBackfillResult> {
  const pageSize = options.pageSize ?? 50
  const minChars = options.minChars ?? 0
  const retries = options.retries ?? DEFAULT_RETRIES
  const checkpoint = options.checkpoint ?? createNullCheckpoint()
  const log = options.log ?? ((line: string) => console.error(`[backfill-chunks] ${line}`))
  const encKey = getEncryptionKey()
  const provider = resolveEmbeddingProvider()
  // remoteUpsertChunks never touches `this.cache`, so a stub is safe here —
  // the same pattern supabase-sync-embedding.test.ts already relies on.
  const sync = options.sync ?? new SupabaseSync(supabase, {} as SqliteCache, projectId)

  const result: ChunkBackfillResult = {
    total: 0,
    resumedPast: 0,
    processed: 0,
    updated: 0,
    belowFloor: 0,
    failed: 0,
    dryRun: !!options.dryRun,
    estimatedChunks: 0,
    estimatedCalls: 0,
    watermark: null,
  }

  const { count, error: countError } = await supabase
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (countError) throw new Error(`Count query failed: ${countError.message}`)
  result.total = count ?? 0

  const chunkOpts =
    provider === 'hosted'
      ? { chunkSizeChars: HOSTED_CHUNK_TARGET_CHARS, overlapChars: HOSTED_CHUNK_OVERLAP_CHARS }
      : { chunkSizeChars: CHUNK_TARGET_CHARS, overlapChars: CHUNK_OVERLAP_CHARS }

  if (options.dryRun) {
    let cursor: string | null = null
    for (;;) {
      const page = await fetchPage(supabase, projectId, cursor, pageSize)
      if (page.length === 0) break
      for (const row of page) {
        const plaintext = decryptRow(row, encKey, log)
        if (plaintext === null) continue
        if (plaintext.length < minChars) {
          result.belowFloor++
          continue
        }
        const chunks = chunkText(plaintext, chunkOpts)
        result.estimatedChunks += chunks.length
        result.estimatedCalls += provider === 'hosted' ? Math.ceil(chunks.length / HOSTED_MAX_BATCH) : chunks.length
      }
      cursor = page[page.length - 1].id
    }
    return result
  }

  let cursor: string | null = options.since ?? checkpoint.load()
  if (cursor) {
    const { count: doneCount, error: doneError } = await supabase
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .lte('id', cursor)
    if (doneError) throw new Error(`Resume count query failed: ${doneError.message}`)
    result.resumedPast = doneCount ?? 0
    result.watermark = cursor
    log(`Resuming after id ${cursor} — ${result.resumedPast}/${result.total} memories already done by a previous run.`)
  }

  const startedAt = Date.now()
  // See backfill-embeddings.ts — once any memory fails, the checkpoint stops
  // advancing for the rest of the run so a later page cannot step over it.
  let watermarkFrozen = false

  for (;;) {
    if (options.shouldStop?.()) {
      log('Stop requested — checkpoint saved, exiting cleanly. Re-run to resume.')
      break
    }

    const page = await fetchPage(supabase, projectId, cursor, pageSize)
    if (page.length === 0) break

    const succeeded = new Set<string>()
    for (const row of page) {
      result.processed++

      const plaintext = decryptRow(row, encKey, log)
      if (plaintext === null) {
        result.failed++
        continue
      }
      if (plaintext.length < minChars) {
        result.belowFloor++
        // Out of scope by request, not a failure — it must not pin the
        // watermark, or --min-chars would make the run unresumable.
        succeeded.add(row.id)
        continue
      }

      try {
        // Bounded retries for the same HTTP 546 WORKER_RESOURCE_LIMIT the
        // pooled script hits — see embedWithRetry in backfill-embeddings.ts.
        // Chunk sets are fail-closed, so a whole memory retries as a unit.
        let chunkResult: Awaited<ReturnType<typeof generateChunkEmbeddings>> = null
        for (let attempt = 0; attempt <= retries; attempt++) {
          chunkResult = await generateChunkEmbeddings(plaintext, {
            supabaseClient: supabase,
            projectId,
          })
          if (chunkResult && chunkResult.chunks.length > 0) break
          if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
        if (!chunkResult || chunkResult.chunks.length === 0) {
          log(`Skipping ${row.id}: no chunk embeddings available`)
          result.failed++
          continue
        }

        // Delete-then-insert per memory, keyed on (project_id, key) — this is
        // what makes an unconditional re-run safe without new delete logic.
        const ok = await sync.remoteUpsertChunks(projectId, row.key, chunkResult.chunks)
        if (!ok) {
          log(`Failed to write chunks for ${row.id}`)
          result.failed++
          continue
        }
        result.updated++
        succeeded.add(row.id)
      } catch (err) {
        log(`Error processing ${row.id}: ${(err as Error).message}`)
        result.failed++
      }
    }

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

async function fetchPage(
  supabase: SupabaseClient,
  projectId: string,
  cursor: string | null,
  pageSize: number,
): Promise<MemoryRow[]> {
  let query = supabase
    .from('memories')
    .select('id, key, value, encrypted')
    .eq('project_id', projectId)
    .order('id', { ascending: true })
    .limit(pageSize)
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

function parseArgs(argv: string[]): CliOptions {
  let project = ''
  let dryRun = false
  let pageSize = 50
  let minChars = 0
  let restart = false
  let since: string | null = null
  let retries = DEFAULT_RETRIES

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--project') project = argv[++i] || ''
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--page-size' || arg === '--batch-size') pageSize = parseInt(argv[++i] || '50', 10)
    else if (arg === '--min-chars') minChars = parseInt(argv[++i] || '0', 10)
    else if (arg === '--restart') restart = true
    else if (arg === '--since') since = argv[++i] || null
    else if (arg === '--retries') retries = parseInt(argv[++i] || String(DEFAULT_RETRIES), 10)
  }

  if (!project) {
    throw new Error(
      'Usage: backfill-chunk-embeddings.ts --project <slug> [--dry-run] [--page-size N] [--min-chars N] [--restart] [--since <id>] [--retries N]\n\n' +
        'This script is intentionally scoped to a single named project. ' +
        'There is no default — pass --project explicitly.\n\n' +
        'Default behaviour is a FULL re-chunk + re-embed of every memory in the project.',
    )
  }

  return { project, dryRun, pageSize, minChars, restart, since, retries }
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const projectConfig = loadProjectConfig(options.project)
  const provider = resolveEmbeddingProvider()

  console.error(`[backfill-chunks] Scope: project "${options.project}" (${projectConfig.projectId}) only.`)
  console.error(
    `[backfill-chunks] Mode: FULL re-chunk of every memory` +
      `${options.minChars > 0 ? ` at or above ${options.minChars} chars` : ''} · provider=${provider}`,
  )

  const supabase = await buildAuthenticatedClient(projectConfig.supabaseUrl, projectConfig.supabaseAnonKey)
  const checkpoint = createFileCheckpoint('memory_chunks', projectConfig.projectId)

  if (options.dryRun) {
    const result = await backfillChunkEmbeddings(supabase, projectConfig.projectId, {
      dryRun: true,
      pageSize: options.pageSize,
      minChars: options.minChars,
    })
    console.log(
      `[backfill-chunks] Dry run: ${result.total - result.belowFloor} of ${result.total} memories in scope ` +
        `(${result.belowFloor} below the --min-chars floor).`,
    )
    console.log(`[backfill-chunks] Would write ${result.estimatedChunks} chunk rows, replacing whatever is there now.`)
    console.log(
      `[backfill-chunks] Estimated ${result.estimatedCalls} hosted round trips ` +
        `(${HOSTED_MAX_BATCH} texts per call), roughly ${formatDuration(result.estimatedCalls * 1700)} of wall time at ~1.7s/call.`,
    )
    const pending = checkpoint.load()
    if (pending) console.log(`[backfill-chunks] A checkpoint exists at id ${pending} — a real run would resume after it (--restart to ignore).`)
    console.log('[backfill-chunks] Nothing was written.')
    return
  }

  if (options.restart) {
    checkpoint.clear()
    console.error('[backfill-chunks] --restart: cleared any stored checkpoint, starting from the beginning.')
  }

  let stop = false
  const onSignal = () => {
    if (stop) process.exit(130)
    stop = true
    console.error('[backfill-chunks] Interrupt received — finishing the current page, then saving the checkpoint. Ctrl-C again to abort now.')
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const result = await backfillChunkEmbeddings(supabase, projectConfig.projectId, {
    pageSize: options.pageSize,
    minChars: options.minChars,
    checkpoint,
    since: options.since,
    retries: options.retries,
    shouldStop: () => stop,
  })

  console.log(
    `[backfill-chunks] Done. total=${result.total} resumedPast=${result.resumedPast} processed=${result.processed} ` +
      `updated=${result.updated} belowFloor=${result.belowFloor} failed=${result.failed}`,
  )
  if (result.failed > 0) {
    console.log(`[backfill-chunks] ${result.failed} memories failed — re-run to retry them (checkpoint held at ${result.watermark ?? 'the start'}).`)
    process.exitCode = 1
  }
}

// Only run when invoked directly (e.g. via `tsx scripts/backfill-chunk-embeddings.ts`),
// not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-chunks] Fatal error:', (err as Error).message)
    process.exit(1)
  })
}
