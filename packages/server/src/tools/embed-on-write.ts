import type { Memory } from '@tages/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export interface EmbedOnWriteOptions {
  /** Resolve after at most this many ms even if embedding is still running. Default: no cap. */
  timeoutMs?: number
}

/**
 * STUB (0.5.7 Step 0 contract): Task 2 fills the body.
 *
 * Generates and stores the embedding (cache.setEmbedding + sync.remoteUpdateEmbedding)
 * and chunk rows for a memory. Fail-open: never rejects.
 * `plaintext` is the unencrypted text to embed (remember passes plaintextForIndex).
 */
export async function embedOnWrite(
  _memory: Memory,
  _plaintext: string,
  _cache: SqliteCache,
  _sync: SupabaseSync | null,
  _supabaseClient?: SupabaseClient,
  _opts?: EmbedOnWriteOptions,
): Promise<void> {
  return
}
