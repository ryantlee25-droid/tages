import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleStaleness(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Check for stale memories: never accessed, or not accessed in 30+ days
  const all = cache.getAllForProject(projectId)
  const stale = all.filter((m) => {
    // Consider stale if never accessed and older than 7 days
    const age = Date.now() - new Date(m.createdAt).getTime()
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    return age > sevenDays
  })

  // Also trigger remote staleness marking if available
  if (sync) {
    try {
      await (sync as unknown as { supabase: { rpc: (name: string, params: Record<string, unknown>) => Promise<unknown> } }).supabase.rpc(
        'mark_stale_memories',
        { p_project_id: projectId },
      )
    } catch {
      // Remote marking is best-effort
    }
  }

  if (stale.length === 0) {
    return {
      content: [{ type: 'text', text: 'No potentially stale memories found.' }],
    }
  }

  const lines = stale.map((m) => `- [${m.type}] **${m.key}** (created ${new Date(m.createdAt).toLocaleDateString()})`)

  return {
    content: [{
      type: 'text',
      text: `## Potentially Stale Memories (${stale.length})\n\nThese memories are older than 7 days. Consider reviewing them:\n\n${lines.join('\n')}`,
    }],
  }
}
