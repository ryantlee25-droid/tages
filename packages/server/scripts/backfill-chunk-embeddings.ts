#!/usr/bin/env node
/**
 * One-time backfill: generate + store per-chunk embeddings (Task 9's
 * `generateChunkEmbeddings` + `remoteUpsertChunks`) for existing long
 * memories written before Phase 2 (multi-vector chunk storage) shipped.
 *
 * SCOPE: a single named project only — same convention as
 * backfill-embeddings.ts. There is no default; --project is required. See
 * that script's own header for the full "why single-project" rationale
 * (unbounded-cost/duration risk against prod).
 *
 * Idempotent: a memory that already has `memory_chunks` rows is skipped, so
 * re-running after a partial failure (or against a project that's already
 * been backfilled) only touches memories still missing chunk rows. Only
 * memories whose (decrypted) value exceeds the chunking threshold
 * (`CHUNK_TARGET_CHARS`, chunking.ts) are candidates at all — short memories
 * get no benefit from per-chunk storage (a single pooled vector already
 * represents them fully; see chunking.ts's header) and are silently passed
 * over, not counted as "skipped".
 *
 * Usage:
 *   npx tsx scripts/backfill-chunk-embeddings.ts --project <slug> --dry-run
 *   npx tsx scripts/backfill-chunk-embeddings.ts --project <slug> [--batch-size 50]
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
import { generateChunkEmbeddings } from '../src/embeddings'
import { getEncryptionKey, decryptValue } from '../src/crypto/encryption'
import { SupabaseSync } from '../src/sync/supabase-sync'
import { CHUNK_TARGET_CHARS } from '../src/chunking'
import type { SqliteCache } from '../src/cache/sqlite'

interface CliOptions {
  project: string
  dryRun: boolean
  batchSize: number
}

interface MemoryRow {
  id: string
  value: string
  encrypted: boolean
}

export interface ChunkBackfillResult {
  /** Only populated on a dry run — count of long memories still missing chunk rows. */
  totalRemaining: number
  processed: number
  updated: number
  skipped: number
  failed: number
  dryRun: boolean
}

/**
 * Core chunk-backfill logic, exported for unit testing with a mocked
 * Supabase client.
 *
 * Unlike backfill-embeddings.ts's `embedding IS NULL` filter (a single
 * boolean column that shrinks as rows are processed, letting it re-run the
 * same query forever until empty), there is no equivalent boolean column
 * here — "already chunked" is "has rows in a different table". So this pages
 * through ALL memories for the project with offset-based `.range()` instead,
 * checking each candidate's existing-chunks state individually. Given this
 * script's explicit single-project scope, the extra per-row existence check
 * is an accepted tradeoff for correctness (a plain `embedding IS NULL`-style
 * filter isn't expressible against a join without a new RPC, which is out of
 * this task's scope — see Task 9/12 file ownership).
 */
export async function backfillChunkEmbeddings(
  supabase: SupabaseClient,
  projectId: string,
  options: { dryRun?: boolean; batchSize?: number } = {},
): Promise<ChunkBackfillResult> {
  const batchSize = options.batchSize ?? 50
  const encKey = getEncryptionKey()
  // Chunk backfill only ever calls remoteUpsertChunks, which doesn't touch
  // `this.cache` — a stub is safe here (same pattern already used in
  // supabase-sync-embedding.test.ts for cache-independent methods).
  const sync = new SupabaseSync(supabase, {} as SqliteCache, projectId)

  const result: ChunkBackfillResult = {
    totalRemaining: 0,
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun: !!options.dryRun,
  }

  function decryptIfNeeded(row: MemoryRow): string | null {
    if (!row.encrypted) return row.value
    if (!encKey) {
      console.error(`[backfill-chunks] Skipping ${row.id}: encrypted but TAGES_ENCRYPTION_KEY is not set`)
      return null
    }
    try {
      return decryptValue(row.value, encKey)
    } catch (err) {
      console.error(`[backfill-chunks] Skipping ${row.id}: decrypt failed: ${(err as Error).message}`)
      return null
    }
  }

  async function hasExistingChunks(memoryId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from('memory_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('memory_id', memoryId)
    if (error) {
      console.error(`[backfill-chunks] Chunk-existence check failed for ${memoryId}: ${error.message}`)
      // Fail closed: treat a failed check as "already has chunks" rather
      // than risk writing a duplicate chunk set for the same memory.
      return true
    }
    return (count ?? 0) > 0
  }

  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('memories')
      .select('id, key, value, encrypted')
      .eq('project_id', projectId)
      .order('id', { ascending: true })
      .range(offset, offset + batchSize - 1)

    if (error) throw new Error(`Query failed: ${error.message}`)
    if (!data || data.length === 0) break
    offset += data.length

    for (const row of data as MemoryRow[]) {
      const plaintext = decryptIfNeeded(row)
      if (plaintext === null) {
        result.failed++
        continue
      }
      // Not a chunking candidate at all — chunkText would return a single
      // chunk equal to the whole value, same as the existing pooled vector
      // already represents. Silently out of scope, not a failure or skip.
      if (plaintext.length <= CHUNK_TARGET_CHARS) continue

      if (options.dryRun) {
        if (!(await hasExistingChunks(row.id))) result.totalRemaining++
        continue
      }

      result.processed++
      try {
        if (await hasExistingChunks(row.id)) {
          result.skipped++
          continue
        }

        const chunkResult = await generateChunkEmbeddings(plaintext)
        if (!chunkResult || chunkResult.chunks.length === 0) {
          console.error(`[backfill-chunks] Skipping ${row.id}: no chunk embeddings available`)
          result.failed++
          continue
        }

        const ok = await sync.remoteUpsertChunks(projectId, row.key, chunkResult.chunks)
        if (ok) {
          result.updated++
        } else {
          console.error(`[backfill-chunks] Failed to write chunks for ${row.id}`)
          result.failed++
        }
      } catch (err) {
        console.error(`[backfill-chunks] Error processing ${row.id}: ${(err as Error).message}`)
        result.failed++
      }
    }
  }

  return result
}

function parseArgs(argv: string[]): CliOptions {
  let project = ''
  let dryRun = false
  let batchSize = 50

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--project') project = argv[++i] || ''
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--batch-size') batchSize = parseInt(argv[++i] || '50', 10)
  }

  if (!project) {
    throw new Error(
      'Usage: backfill-chunk-embeddings.ts --project <slug> [--dry-run] [--batch-size N]\n\n' +
      'This script is intentionally scoped to a single named project. ' +
      'There is no default — pass --project explicitly.',
    )
  }

  return { project, dryRun, batchSize }
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

  const configDir = path.join(os.homedir(), '.config', 'tages')
  const projectConfigPath = path.join(configDir, 'projects', `${options.project}.json`)
  if (!fs.existsSync(projectConfigPath)) {
    console.error(`No project config found for slug "${options.project}" at ${projectConfigPath}`)
    process.exit(1)
  }
  const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8')) as {
    projectId: string
    supabaseUrl: string
    supabaseAnonKey: string
  }

  console.error(`[backfill-chunks] Scope: project "${options.project}" (${projectConfig.projectId}) only.`)

  const supabase = await buildAuthenticatedClient(projectConfig.supabaseUrl, projectConfig.supabaseAnonKey)

  if (options.dryRun) {
    const result = await backfillChunkEmbeddings(supabase, projectConfig.projectId, { dryRun: true })
    console.log(`[backfill-chunks] Dry run: ${result.totalRemaining} long memories missing chunk rows.`)
    console.log(`[backfill-chunks] Estimated OpenAI embedding calls needed: at least ${result.totalRemaining} (1+ per memory, depending on chunk count).`)
    return
  }

  const result = await backfillChunkEmbeddings(supabase, projectConfig.projectId, { batchSize: options.batchSize })
  console.log(`[backfill-chunks] Done. processed=${result.processed} updated=${result.updated} skipped=${result.skipped} failed=${result.failed}`)
}

// Only run when invoked directly (e.g. via `tsx scripts/backfill-chunk-embeddings.ts`),
// not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-chunks] Fatal error:', (err as Error).message)
    process.exit(1)
  })
}
