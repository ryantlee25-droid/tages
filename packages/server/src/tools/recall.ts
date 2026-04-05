import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleRecall(
  args: { query: string; type?: string; limit?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit || 5

  // Try Supabase first for trigram search
  if (sync) {
    const results = await sync.remoteRecall(args.query, args.type, limit)
    if (results) {
      return formatResults(results, args.query)
    }
    console.error('[tages] Falling back to SQLite cache for recall')
  }

  // Fallback to SQLite LIKE search
  const results = cache.queryMemories(
    projectId,
    args.query,
    args.type as MemoryType | undefined,
    limit,
  )
  return formatResults(results, args.query)
}

function formatResults(
  memories: Memory[],
  query: string,
): { content: Array<{ type: 'text'; text: string }> } {
  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: `No memories found matching "${query}".` }],
    }
  }

  const lines = memories.map((m, i) => {
    const files = m.filePaths?.length ? `\n   Files: ${m.filePaths.join(', ')}` : ''
    const tags = m.tags?.length ? `\n   Tags: ${m.tags.join(', ')}` : ''
    return `${i + 1}. [${m.type}] ${m.key}\n   ${m.value}${files}${tags}`
  })

  return {
    content: [{
      type: 'text',
      text: `Found ${memories.length} memories for "${query}":\n\n${lines.join('\n\n')}`,
    }],
  }
}
