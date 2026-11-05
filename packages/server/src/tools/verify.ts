import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { embedOnWrite } from './embed-on-write'
import { getEncryptionKey, decryptValue } from '../crypto/encryption'

/** Same capped await as observe/session_end: short-lived servers exit fast. */
const EMBED_TIMEOUT_MS = 10_000

export async function handleVerifyMemory(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  supabaseClient?: SupabaseClient,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const memory = cache.getByKey(projectId, args.key)

  if (!memory) {
    return {
      content: [{ type: 'text', text: `No memory found with key "${args.key}".` }],
    }
  }

  if (memory.status === 'live') {
    return {
      content: [{ type: 'text', text: `Memory "${args.key}" is already verified and live.` }],
    }
  }

  const now = new Date().toISOString()

  if (sync) {
    // Remote FIRST; the local row is promoted only after the shared store
    // confirms. The REMOTE row is addressed by (project_id, key), not
    // memory.id: remote upserts strip the local id, so the ids diverge.
    // false = error OR zero rows changed (RLS silently filters a read-only
    // member's UPDATE down to 0 rows) OR the key is not in the shared store.
    // A row that never reached the shared store (still dirty locally) is
    // pushed first, already live; a refused push fails the verify.
    const unsynced = cache.getSyncIndex(projectId).some((r) => r.key === memory.key && r.dirty)
    let ok: boolean
    if (unsynced) {
      ok = await sync.remoteInsert({ ...memory, status: 'live', verifiedAt: now, updatedAt: now })
      if (ok) ok = await sync.remoteVerifyMemory(projectId, memory.key, now)
    } else {
      ok = await sync.remoteVerifyMemory(projectId, memory.key, now)
    }
    if (!ok) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Permission denied: could not verify "${args.key}" in the shared store. Your role cannot verify ` +
            'or approve memories on this project (read-only members cannot), or the row is not visible to you. ' +
            'Nothing was changed; the memory is still pending.',
        }],
      }
    }
  }

  // Local cache is correctly keyed by the local row id.
  cache.updateMemoryStatus(memory.id, 'live', now)

  // Promotion makes the row recall-visible, so make sure it is semantically
  // findable. getByKey does not load the embedding column, so there is no
  // cheap presence check; verify is a rare call, so always (re)embed. Covers
  // rows created before 0.5.7 and rows inserted directly with no vector.
  let plaintext = memory.value
  if (memory.encrypted) {
    const encKey = getEncryptionKey()
    plaintext = encKey ? decryptValue(memory.value, encKey) : ''
  }
  if (plaintext) {
    await embedOnWrite(memory, plaintext, cache, sync, supabaseClient, { timeoutMs: EMBED_TIMEOUT_MS })
  }

  return {
    content: [{
      type: 'text',
      text: `Verified: "${args.key}" is now live and will appear in recall results.`,
    }],
  }
}

export async function handlePendingMemories(
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const pending = cache.getPendingMemories(projectId)

  if (pending.length === 0) {
    return {
      content: [{ type: 'text', text: 'No pending memories to review.' }],
    }
  }

  const lines = pending.map((m, i) =>
    `${i + 1}. [${m.type}] **${m.key}** (confidence: ${m.confidence})\n   ${m.value}`,
  )

  return {
    content: [{
      type: 'text',
      text: `## Pending Memories (${pending.length})\n\nThese were auto-extracted and need verification before appearing in recall:\n\n${lines.join('\n\n')}\n\nUse \`verify_memory\` with the key to promote to live.`,
    }],
  }
}
