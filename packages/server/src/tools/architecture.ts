import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleArchitecture(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let memories: Memory[]

  if (sync) {
    const remote = await sync.remoteGetByType('architecture')
    memories = remote || cache.getByType(projectId, 'architecture')
  } else {
    memories = cache.getByType(projectId, 'architecture')
  }

  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: 'No architecture notes recorded for this project.' }],
    }
  }

  const lines = memories.map(m => {
    const files = m.filePaths?.length ? ` (${m.filePaths.join(', ')})` : ''
    return `- **${m.key}**${files}: ${m.value}`
  })

  return {
    content: [{
      type: 'text',
      text: `## Architecture Notes\n\n${lines.join('\n\n')}`,
    }],
  }
}
