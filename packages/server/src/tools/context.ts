import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { enrichFilePaths, formatFileContext } from './file-enrichment'

export async function handleContext(
  args: { filePath: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Get memories related to a specific file path
  let memories: Memory[]

  if (sync) {
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

  // Enrich with file metadata
  const fileContexts = enrichFilePaths([args.filePath])
  const fileInfo = formatFileContext(fileContexts)

  const sections: string[] = []
  sections.push(`## Context for ${args.filePath}`)
  sections.push('')
  sections.push('### File Info')
  sections.push(fileInfo)

  if (memories.length > 0) {
    sections.push('')
    sections.push(`### Related Memories (${memories.length})`)
    for (const m of memories) {
      sections.push(`- [${m.type}] **${m.key}**: ${m.value}`)
    }
  } else {
    sections.push('')
    sections.push('No memories reference this file.')
  }

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
  }
}
