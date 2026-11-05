import type { Memory } from '@tages/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import { generateEmbedding, generateChunkEmbeddings } from '../embeddings'

export interface EmbedOnWriteOptions {
  /** Resolve after at most this many ms even if embedding is still running. Default: no cap. */
  timeoutMs?: number
}

/**
 * The hosted embedding provider needs a Supabase client (URL + session token).
 * Callers that were never threaded one (observe, session_end, verify_memory,
 * import_claude_md are wired in index.ts without it) would otherwise get no
 * embedding at all in production. SupabaseSync is built from that same
 * authenticated client, so reuse it through its public `client` getter.
 */
function resolveClient(sync: SupabaseSync | null, supabaseClient?: SupabaseClient): SupabaseClient | undefined {
  if (supabaseClient) return supabaseClient
  return sync?.client
}

/**
 * Generate a semantic-search embedding (pooled) and per-chunk embeddings for a
 * memory, and store both locally and in Supabase. Moved verbatim in behavior
 * from remember.ts `scheduleEmbeddingSync` so every write path (remember,
 * observe, session_end, verify_memory, import_claude_md, boot backfill) uses
 * ONE embedding path.
 *
 * `plaintext` is the unencrypted text to embed: never pass ciphertext.
 * Inputs over the provider's single-call limit (8192 tokens for OpenAI, the
 * gte-small ceiling for hosted) are chunked and mean-pooled inside
 * generateEmbedding, so long values get a real vector on every path.
 *
 * Race-safety: this resolves seconds after the write, so it performs only
 * NARROW, embedding-only, (project_id, key)-keyed updates: cache.setEmbedding
 * (never touches value/tags/dirty) and sync.remoteUpdateEmbedding (an
 * `.update()` on the serialized queue, so it cannot resurrect a row deleted
 * by a concurrent forget or clobber a newer value). It does NOT markSynced:
 * whole-row dirty state belongs to the write path.
 *
 * Fail-open: NEVER rejects. A null pooled embedding is logged, not swallowed.
 * With `timeoutMs`, the returned promise resolves after at most that long;
 * the embedding work keeps running in the background.
 */
export function embedOnWrite(
  memory: Memory,
  plaintext: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  supabaseClient?: SupabaseClient,
  opts?: EmbedOnWriteOptions,
): Promise<void> {
  const { projectId, key } = memory
  // Both chains get the SAME options object, so the pooled vector and the
  // per-chunk vectors come from one provider against one project: they are
  // compared to each other at recall time.
  const embedOpts = { supabaseClient: resolveClient(sync, supabaseClient), projectId }

  // Promise.resolve().then(...) so even a synchronous throw lands in .catch().
  const pooled = Promise.resolve()
    .then(() => generateEmbedding(plaintext, embedOpts))
    .then(async (embedding) => {
      if (!embedding) {
        console.error(
          `[tages] No embedding generated for "${key}" (provider returned null); ` +
            'it is findable by text search only until a backfill succeeds.',
        )
        return
      }
      cache.setEmbedding(projectId, key, embedding)
      if (sync) {
        const ok = await sync.remoteUpdateEmbedding(projectId, key, embedding)
        if (!ok) console.error(`[tages] Remote embedding update failed for "${key}"`)
      }
    })
    .catch((err) => {
      console.error('[tages] Embedding generation/sync failed:', (err as Error).message)
    })

  // Chunk rows: a SEPARATE chain, so a chunk failure never affects the pooled
  // write. Keyed by memory.id (memory_chunks carries a memory_id FK).
  const chunks = Promise.resolve()
    .then(() => generateChunkEmbeddings(plaintext, embedOpts))
    .then(async (result) => {
      if (!result) return
      // Encrypt chunk_text at rest with the same key as memories.value, so the
      // chunk mirror never leaks plaintext. Vectors were computed from plaintext.
      const encKey = getEncryptionKey()
      const chunksAtRest = encKey
        ? result.chunks.map((c) => ({ text: encryptValue(c.text, encKey), embedding: c.embedding }))
        : result.chunks
      // markChunksSynced clears dirty only for the rows just inserted, so a
      // concurrent v2 chunk write during the remote await is not clobbered.
      const rowIds = cache.upsertChunks(memory.id, projectId, chunksAtRest)
      if (sync) {
        const ok = await sync.remoteUpsertChunks(projectId, memory.key, chunksAtRest)
        if (ok) cache.markChunksSynced(rowIds)
      }
    })
    .catch((err) => {
      console.error('[tages] Chunk embedding generation/sync failed:', (err as Error).message)
    })

  const all = Promise.all([pooled, chunks]).then(() => undefined)
  const timeoutMs = opts?.timeoutMs
  if (timeoutMs == null) return all

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[tages] Embedding for "${key}" still running after ${timeoutMs}ms; continuing in the background`)
      resolve()
    }, timeoutMs)
    timer.unref?.()
    void all.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
