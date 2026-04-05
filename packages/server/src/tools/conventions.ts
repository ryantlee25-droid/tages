import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleConventions(
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let memories: Memory[]

  if (sync) {
    const remote = await sync.remoteGetByType('convention')
    memories = remote || cache.getByType(projectId, 'convention')
  } else {
    memories = cache.getByType(projectId, 'convention')
  }

  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: 'No conventions recorded for this project.' }],
    }
  }

  const lines = memories.map(m => `- **${m.key}**: ${m.value}`)
  return {
    content: [{
      type: 'text',
      text: `## Project Conventions\n\n${lines.join('\n\n')}`,
    }],
  }
}
