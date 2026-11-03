import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from './supabase-sync'
import { embedOnWrite } from '../tools/embed-on-write'
import { getEncryptionKey, decryptValue } from '../crypto/encryption'

/** Default rows per boot backfill. Keeps boot-time provider calls bounded. */
export const BACKFILL_LIMIT = 20
/** Per-row cap: a hung provider call cannot stall the rest of the batch. */
export const BACKFILL_ROW_TIMEOUT_MS = 10_000
/**
 * Rows read per provider call allowed. The read is a cheap local query; the
 * wider window lets the backfill step past rows it cannot embed (no key,
 * corrupt ciphertext, empty value, already failed) instead of spending the
 * whole run on the same newest rows every boot.
 */
export const BACKFILL_WINDOW_FACTOR = 5

/**
 * Ids already attempted in this process. Skipped by later runs in the same
 * process so a row the provider always refuses (null, throw, timeout) cannot
 * eat the budget twice. Not persisted: a fresh process retries them.
 */
const failedThisProcess = new Set<string>()

/** Test hook: forget the in-process failure set. */
export function resetBackfillFailures(): void {
  failedThisProcess.clear()
}

/**
 * Bounded boot backfill for live memories that have no embedding (rows
 * created before 0.5.7, approved in the CLI, whose embed call failed, or
 * left unembedded when a bulk write hit its embedding deadline).
 * Without a vector they are reachable by exact-substring search only.
 *
 * Reads up to `limit * BACKFILL_WINDOW_FACTOR` candidates (newest first) and
 * makes at most `limit` provider calls, one at a time, through the shared
 * `embedOnWrite` path. Rows that cannot be embedded (encrypted without a
 * usable key, empty, or already failed in this process) are skipped without
 * spending a provider call, so they cannot starve older rows. A null
 * embedding is skipped, a real one is written to the cache and pushed with
 * `remoteUpdateEmbedding`.
 *
 * Never rejects. The caller must not await it on the boot critical path.
 * Returns the number of rows attempted (provider calls made).
 */
export async function runEmbeddingBackfill(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  supabaseClient?: SupabaseClient,
  opts?: { limit?: number; rowTimeoutMs?: number },
): Promise<number> {
  const limit = Math.max(0, opts?.limit ?? BACKFILL_LIMIT)
  const rowTimeoutMs = opts?.rowTimeoutMs ?? BACKFILL_ROW_TIMEOUT_MS
  let attempted = 0
  try {
    if (limit === 0) return 0
    const rows = cache.getLiveMissingEmbedding(projectId, limit * BACKFILL_WINDOW_FACTOR)
    if (rows.length === 0) return 0
    console.error(`[tages] Embedding backfill: ${rows.length} live memories without an embedding (embedding up to ${limit})`)
    for (const memory of rows) {
      if (attempted >= limit) break
      if (failedThisProcess.has(memory.id)) continue
      try {
        let plaintext = memory.value
        if (memory.encrypted) {
          const encKey = getEncryptionKey()
          plaintext = encKey ? decryptValue(memory.value, encKey) : ''
        }
        if (!plaintext) continue
        attempted++
        // One attempt per row per process. A success leaves the candidate set
        // anyway (embedding IS NOT NULL); a null, swallowed error or timeout
        // must not take a second provider call from this process's budget.
        failedThisProcess.add(memory.id)
        await embedOnWrite(memory, plaintext, cache, sync, supabaseClient, { timeoutMs: rowTimeoutMs })
      } catch (err) {
        console.error(`[tages] Embedding backfill skipped "${memory.key}": ${(err as Error).message}`)
      }
    }
  } catch (err) {
    console.error('[tages] Embedding backfill failed:', (err as Error).message)
  }
  return attempted
}
