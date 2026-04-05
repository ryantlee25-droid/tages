import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleDecisions(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let memories: Memory[]

  if (sync) {
    const remote = await sync.remoteGetByType('decision')
    memories = remote || cache.getByType(projectId, 'decision')
  } else {
    memories = cache.getByType(projectId, 'decision')
  }

  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: 'No decisions recorded for this project.' }],
    }
  }

  const lines = memories.map(m => `- **${m.key}**: ${m.value}`)
  return {
    content: [{
      type: 'text',
      text: `## Project Decisions\n\n${lines.join('\n\n')}`,
    }],
  }
}
