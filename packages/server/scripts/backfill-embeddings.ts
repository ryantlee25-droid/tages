#!/usr/bin/env node
/**
 * One-time backfill: generate + store embeddings for existing memories that
 * predate Task 8's write-path fix (embedding IS NULL).
 *
 * SCOPE: a single named project (the dogfood sandbox) only, by design.
 * Full-production backfill across all Supabase projects is explicitly out
 * of scope for this script until RQ8 (see PLAN-MEMORY-FIXES.md) answers the
 * actual row count/cost — running this unscoped against prod risks an
 * unbounded-cost, unbounded-duration job. There is no default project; you
 * must pass --project explicitly.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts --project <slug> --dry-run
 *   npx tsx scripts/backfill-embeddings.ts --project <slug> [--batch-size 50]
 *
 * Auth precedence (matches packages/cli/src/auth/session.ts):
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
import { generateEmbedding } from '../src/embeddings'
import { getEncryptionKey, decryptValue } from '../src/crypto/encryption'
import { embeddingToPgVector } from '../src/sync/supabase-sync'

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

export interface BackfillResult {
  /** Only populated on a dry run — total rows currently missing an embedding. */
  totalRemaining: number
  processed: number
  updated: number
  failed: number
  dryRun: boolean
}

/**
 * Core backfill logic, exported for unit testing with a mocked Supabase
 * client. Pages through `memories WHERE project_id = ? AND embedding IS
 * NULL`, generating + writing embeddings until none remain. Idempotent:
 * re-running after a partial failure only touches rows still missing an
 * embedding.
 */
export async function backfillEmbeddings(
  supabase: SupabaseClient,
  projectId: string,
  options: { dryRun?: boolean; batchSize?: number } = {},
): Promise<BackfillResult> {
  const batchSize = options.batchSize ?? 50
  const encKey = getEncryptionKey()

  const result: BackfillResult = {
    totalRemaining: 0,
    processed: 0,
    updated: 0,
    failed: 0,
    dryRun: !!options.dryRun,
  }

  if (options.dryRun) {
    const { count, error } = await supabase
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('embedding', null)
    if (error) throw new Error(`Dry-run count query failed: ${error.message}`)
    result.totalRemaining = count ?? 0
    return result
  }

  // Rows that failed once this run (no provider available, decrypt error,
  // update error) are never removed from `embedding IS NULL`, so a naive
  // "keep paging until empty" loop would re-fetch and re-fail them forever.
  // Track them and stop once an entire batch is nothing but already-failed
  // rows — that means no further progress is possible this run.
  const failedIds = new Set<string>()

  for (;;) {
    const { data, error } = await supabase
      .from('memories')
      .select('id, value, encrypted')
      .eq('project_id', projectId)
      .is('embedding', null)
      .limit(batchSize)

    if (error) throw new Error(`Query failed: ${error.message}`)
    if (!data || data.length === 0) break

    const freshRows = (data as MemoryRow[]).filter((row) => !failedIds.has(row.id))
    if (freshRows.length === 0) {
      console.error(`[backfill] Stopping: ${failedIds.size} memories could not be embedded this run and remain embedding IS NULL. Re-run once a provider is available.`)
      break
    }

    for (const row of freshRows) {
      result.processed++
      try {
        let plaintext = row.value
        if (row.encrypted) {
          if (!encKey) {
            console.error(`[backfill] Skipping ${row.id}: encrypted but TAGES_ENCRYPTION_KEY is not set`)
            result.failed++
            failedIds.add(row.id)
            continue
          }
          plaintext = decryptValue(row.value, encKey)
        }

        const embedding = await generateEmbedding(plaintext)
        if (!embedding) {
          console.error(`[backfill] Skipping ${row.id}: no embedding provider available`)
          result.failed++
          failedIds.add(row.id)
          continue
        }

        const { error: updateError } = await supabase
          .from('memories')
          .update({ embedding: embeddingToPgVector(embedding) })
          .eq('id', row.id)

        if (updateError) {
          console.error(`[backfill] Failed to update ${row.id}: ${updateError.message}`)
          result.failed++
          failedIds.add(row.id)
        } else {
          result.updated++
        }
      } catch (err) {
        console.error(`[backfill] Error processing ${row.id}: ${(err as Error).message}`)
        result.failed++
        failedIds.add(row.id)
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
      'Usage: backfill-embeddings.ts --project <slug> [--dry-run] [--batch-size N]\n\n' +
      'This script is intentionally scoped to a single named project (the dogfood sandbox). ' +
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

  console.error(`[backfill] Scope: project "${options.project}" (${projectConfig.projectId}) only.`)
  console.error('[backfill] Full-production backfill is out of scope for this script — see PLAN-MEMORY-FIXES.md RQ8.')

  const supabase = await buildAuthenticatedClient(projectConfig.supabaseUrl, projectConfig.supabaseAnonKey)

  if (options.dryRun) {
    const result = await backfillEmbeddings(supabase, projectConfig.projectId, { dryRun: true })
    console.log(`[backfill] Dry run: ${result.totalRemaining} memories have embedding IS NULL.`)
    console.log(`[backfill] Estimated embedding calls needed: ${result.totalRemaining} (1 network call per memory; cost/latency depend on the active provider).`)
    return
  }

  const result = await backfillEmbeddings(supabase, projectConfig.projectId, { batchSize: options.batchSize })
  console.log(`[backfill] Done. processed=${result.processed} updated=${result.updated} failed=${result.failed}`)
}

// Only run when invoked directly (e.g. via `tsx scripts/backfill-embeddings.ts`),
// not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill] Fatal error:', (err as Error).message)
    process.exit(1)
  })
}
