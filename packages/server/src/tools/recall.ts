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

  // Generate embedding for semantic search (works locally via Ollama)
  const embedding = await generateEmbedding(args.query)

  // Try local semantic search first (sub-10ms, no network)
  if (embedding) {
    const localSemantic = cache.semanticQuery(
      projectId, embedding, args.type as MemoryType | undefined, limit,
    )
    const localLike = cache.queryMemories(
      projectId, args.query, args.type as MemoryType | undefined, limit,
    )

    // Merge and deduplicate
    const seen = new Set<string>()
    const merged: Memory[] = []
    for (const m of localSemantic) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
    }
    for (const m of localLike) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
    }

    if (merged.length > 0) {
      return formatResults(merged.slice(0, limit), args.query, 'local (cached)')
    }
  }

  // If local cache is empty, try remote
  if (sync) {
    if (embedding) {
      const results = await sync.remoteHybridRecall(args.query, embedding, args.type, limit)
      if (results && results.length > 0) {
        return formatResults(results, args.query, 'remote (hybrid)')
      }
    }

    const results = await sync.remoteRecall(args.query, args.type, limit)
    if (results && results.length > 0) {
      return formatResults(results, args.query, 'remote (trigram)')
    }
  }

  // Last fallback: SQLite LIKE search without embeddings
  const results = cache.queryMemories(
    projectId, args.query, args.type as MemoryType | undefined, limit,
  )
  return formatResults(results, args.query, 'local (text match)')
}

function formatResults(
  memories: Memory[],
  query: string,
  method: string,
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
      text: `Found ${memories.length} memories for "${query}" (${method}):\n\n${lines.join('\n\n')}`,
    }],
  }
}
