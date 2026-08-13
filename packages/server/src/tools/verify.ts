import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleVerifyMemory(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
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
  // Local cache is correctly keyed by the local row id.
  cache.updateMemoryStatus(memory.id, 'live', now)

  if (sync) {
    // The REMOTE row must be addressed by (project_id, key), not memory.id:
    // remote upserts strip the local id, so Supabase's row id diverges from
    // the local one and an id-keyed update matches nothing.
    await sync.remoteVerifyMemory(projectId, memory.key, now)
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
