import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleContext(
  args: { filePath: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Get memories related to a specific file path
  let memories: Memory[]

  if (sync) {
    // Try remote first — recall using file path as query
    const remote = await sync.remoteRecall(args.filePath, undefined, 10)
    if (remote && remote.length > 0) {
      memories = remote
    } else {
      memories = cache.getByFilePath(projectId, args.filePath)
    }
  } else {
    memories = cache.getByFilePath(projectId, args.filePath)
  }

  // Also search by query to catch memories that mention the file path in value
  const queryResults = cache.queryMemories(projectId, args.filePath, undefined, 10)
  const seen = new Set(memories.map(m => m.id))
  for (const m of queryResults) {
    if (!seen.has(m.id)) {
      memories.push(m)
      seen.add(m.id)
    }
  }

  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: `No context found for "${args.filePath}".` }],
    }
  }

  const lines = memories.map(m => `- [${m.type}] **${m.key}**: ${m.value}`)
  return {
    content: [{
      type: 'text',
      text: `## Context for ${args.filePath}\n\n${lines.join('\n\n')}`,
    }],
  }
}
