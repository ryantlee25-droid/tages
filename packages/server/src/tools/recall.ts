import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { generateEmbedding } from '../embeddings'

export async function handleRecall(
  args: { query: string; type?: string; limit?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit || 5

  // Try hybrid search: trigram + vector
  if (sync) {
    // Generate embedding for the query
    const embedding = await generateEmbedding(args.query)

    if (embedding) {
      // Use hybrid recall (trigram + semantic)
      const results = await sync.remoteHybridRecall(args.query, embedding, args.type, limit)
      if (results && results.length > 0) {
        return formatResults(results, args.query, true)
      }
    }

    // Fallback to trigram-only if embedding failed
    const results = await sync.remoteRecall(args.query, args.type, limit)
    if (results && results.length > 0) {
      return formatResults(results, args.query, false)
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
  return formatResults(results, args.query, false)
}

function formatResults(
  memories: Memory[],
  query: string,
  hybrid: boolean,
): { content: Array<{ type: 'text'; text: string }> } {
  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: `No memories found matching "${query}".` }],
    }
  }

  const method = hybrid ? ' (hybrid: trigram + semantic)' : ''
  const lines = memories.map((m, i) => {
    const files = m.filePaths?.length ? `\n   Files: ${m.filePaths.join(', ')}` : ''
    const tags = m.tags?.length ? `\n   Tags: ${m.tags.join(', ')}` : ''
    return `${i + 1}. [${m.type}] ${m.key}\n   ${m.value}${files}${tags}`
  })

  return {
    content: [{
      type: 'text',
      text: `Found ${memories.length} memories for "${query}"${method}:\n\n${lines.join('\n\n')}`,
    }],
  }
}
