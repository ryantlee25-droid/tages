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
  cache.updateMemoryStatus(memory.id, 'live', now)

  if (sync) {
    try {
      await (sync as unknown as { supabase: { from: (t: string) => { update: (d: Record<string, unknown>) => { eq: (k: string, v: string) => Promise<unknown> } } } }).supabase
        .from('memories')
        .update({ status: 'live', verified_at: now })
        .eq('id', memory.id)
    } catch {
      // Best effort
    }
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
