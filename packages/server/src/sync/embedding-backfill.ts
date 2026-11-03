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
 * Bounded boot backfill for live memories that have no embedding (rows
 * created before 0.5.7, approved in the CLI, or whose embed call failed).
 * Without a vector they are reachable by exact-substring search only.
 *
 * Processes at most `limit` rows (newest first), one at a time, through the
 * shared `embedOnWrite` path: a null embedding is skipped, a real one is
 * written to the cache and pushed with `remoteUpdateEmbedding`.
 *
 * Never rejects. The caller must not await it on the boot critical path.
 * Returns the number of rows attempted.
 */
export async function runEmbeddingBackfill(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  supabaseClient?: SupabaseClient,
  opts?: { limit?: number; rowTimeoutMs?: number },
): Promise<number> {
  const limit = opts?.limit ?? BACKFILL_LIMIT
  const rowTimeoutMs = opts?.rowTimeoutMs ?? BACKFILL_ROW_TIMEOUT_MS
  let attempted = 0
  try {
    const rows = cache.getLiveMissingEmbedding(projectId, limit).slice(0, Math.max(0, limit))
    if (rows.length === 0) return 0
    console.error(`[tages] Embedding backfill: ${rows.length} live memories without an embedding`)
    for (const memory of rows) {
      try {
        let plaintext = memory.value
        if (memory.encrypted) {
          const encKey = getEncryptionKey()
          plaintext = encKey ? decryptValue(memory.value, encKey) : ''
        }
        if (!plaintext) continue
        attempted++
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
