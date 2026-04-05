import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleStats(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const all = cache.getAllForProject(projectId)

  // Count by type
  const typeCounts: Record<string, number> = {}
  const sourceCounts: Record<string, number> = {}
  for (const m of all) {
    typeCounts[m.type] = (typeCounts[m.type] || 0) + 1
    sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1
  }

  // Try remote stats if available
  let remoteStats = ''
  if (sync) {
    try {
      const supabase = (sync as unknown as { supabase: { rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown }> } }).supabase
      const { data } = await supabase.rpc('project_usage_stats', { p_project_id: projectId })
      if (data) {
        const s = data as Record<string, unknown>
        remoteStats = `\n## Usage Analytics\n- Total sessions: ${s.total_sessions}\n- Total recalls: ${s.total_recalls}\n- Recall hit rate: ${(Number(s.recall_hit_rate) * 100).toFixed(0)}%\n- Never accessed (7+ days old): ${s.never_accessed}\n- Stale memories: ${s.stale_memories}`
      }
    } catch {
      // Best-effort
    }
  }

  const typeLines = Object.entries(typeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `  ${type}: ${count}`)
    .join('\n')

  const sourceLines = Object.entries(sourceCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([source, count]) => `  ${source}: ${count}`)
    .join('\n')

  return {
    content: [{
      type: 'text',
      text: `## Project Memory Stats\n\nTotal: ${all.length}\n\nBy type:\n${typeLines}\n\nBy source:\n${sourceLines}${remoteStats}`,
    }],
  }
}
