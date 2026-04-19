import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { generateEmbedding } from '../embeddings'
import { rankResults, asTextResults } from '../search/ranker'
import type { ScoredMemory } from '../search/ranker'
import { computeDecayScore, shouldArchive } from '../decay/scoring'
import { getEncryptionKey, decryptValue } from '../crypto/encryption'
import { budgetedResults } from '../search/token-budget'

function decryptMemories(memories: Memory[]): Memory[] {
  const encKey = getEncryptionKey()
  return memories.map((m) => {
    if (m.encrypted) {
      if (!encKey) {
        // Memory is marked as encrypted but no key is available — fail loudly
        return { ...m, value: '[ERROR: memory is encrypted but TAGES_ENCRYPTION_KEY is not set]' }
      }
      return { ...m, value: decryptValue(m.value, encKey) }
    }
    // Not encrypted — return as-is regardless of whether a key is configured
    return m
  })
}

export async function handleRecall(
  args: { query: string; type?: string; limit?: number; maxTokens?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit || 5

  // Generate embedding for semantic search (works locally via Ollama)
  const embedding = await generateEmbedding(args.query)

  // Try local unified scoring first (sub-10ms, no network)
  const scoredResults = cache.scoredQuery(
    projectId,
    args.query,
    embedding || null,
    args.type as MemoryType | undefined,
    limit * 3, // over-fetch for ranking
  )

  if (scoredResults.length > 0) {
    // Update access times for all recalled memories (T6)
    for (const { memory } of scoredResults) {
      cache.updateAccessTime(memory.id)
    }

    // Apply decay scoring to demote stale results (T6)
    const decayAdjusted: ScoredMemory[] = scoredResults.map(r => {
      const accessInfo = cache.getAccessInfo(r.memory.id)
      const decayScore = computeDecayScore(r.memory, {
        lastAccessedAt: accessInfo?.lastAccessedAt,
        accessCount: accessInfo?.accessCount ?? 0,
      })
      // Demote stale memories: multiply text/semantic scores by (1 - decay * 0.5)
      const decayPenalty = 1 - decayScore * 0.5
      return {
        memory: r.memory,
        semanticScore: r.semanticScore * decayPenalty,
        textScore: r.textScore * decayPenalty,
      }
    })

    const ranked = rankResults(decayAdjusted)
    let sliced = decryptMemories(ranked.slice(0, limit))
    if (args.maxTokens !== undefined) {
      sliced = budgetedResults(sliced, args.maxTokens, formatMemory)
    }
    return formatResults(sliced, args.query, 'local (ranked)')
  }

  // If local cache is empty, try remote
  if (sync) {
    if (embedding) {
      const results = await sync.remoteHybridRecall(args.query, embedding, args.type, limit)
      if (results && results.length > 0) {
        let trimmed = decryptMemories(results)
        if (args.maxTokens !== undefined) {
          trimmed = budgetedResults(trimmed, args.maxTokens, formatMemory)
        }
        return formatResults(trimmed, args.query, 'remote (hybrid)')
      }
    }

    const results = await sync.remoteRecall(args.query, args.type, limit)
    if (results && results.length > 0) {
      let trimmed = decryptMemories(results)
      if (args.maxTokens !== undefined) {
        trimmed = budgetedResults(trimmed, args.maxTokens, formatMemory)
      }
      return formatResults(trimmed, args.query, 'remote (trigram)')
    }
  }

  // Last fallback: SQLite LIKE search without embeddings
  const fallback = cache.queryMemories(
    projectId, args.query, args.type as MemoryType | undefined, limit,
  )
  const ranked = rankResults(asTextResults(fallback))
  let sliced = decryptMemories(ranked.slice(0, limit))
  if (args.maxTokens !== undefined) {
    sliced = budgetedResults(sliced, args.maxTokens, formatMemory)
  }
  return formatResults(sliced, args.query, 'local (text match)')
}

// Format a single memory to a string — used for token estimation
function formatMemory(m: Memory): string {
  const parts = [`[${m.type}] ${m.key}`, `   ${m.value}`]
  if (m.filePaths?.length) parts.push(`   Files: ${m.filePaths.join(', ')}`)
  if (m.conditions?.length) parts.push(`   When: ${m.conditions.join('; ')}`)
  if (m.crossSystemRefs?.length) parts.push(`   Related: ${m.crossSystemRefs.join(', ')}`)
  if (m.executionFlow) {
    parts.push(`   Flow: ${m.executionFlow.trigger} → ${m.executionFlow.steps.join(' → ')}`)
  }
  if (m.examples?.length) {
    for (const ex of m.examples.slice(0, 2)) {
      parts.push(`   Example: ${ex.input} → ${ex.output}${ex.note ? ` (${ex.note})` : ''}`)
    }
  }
  if (m.tags?.length) parts.push(`   Tags: ${m.tags.join(', ')}`)
  return parts.join('\n')
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
    const parts = [`${i + 1}. [${m.type}] ${m.key}`, `   ${m.value}`]
    if (m.filePaths?.length) parts.push(`   Files: ${m.filePaths.join(', ')}`)
    if (m.conditions?.length) parts.push(`   When: ${m.conditions.join('; ')}`)
    if (m.crossSystemRefs?.length) parts.push(`   Related: ${m.crossSystemRefs.join(', ')}`)
    if (m.executionFlow) {
      parts.push(`   Flow: ${m.executionFlow.trigger} → ${m.executionFlow.steps.join(' → ')}`)
    }
    if (m.examples?.length) {
      for (const ex of m.examples.slice(0, 2)) {
        parts.push(`   Example: ${ex.input} → ${ex.output}${ex.note ? ` (${ex.note})` : ''}`)
      }
    }
    if (m.tags?.length) parts.push(`   Tags: ${m.tags.join(', ')}`)
    return parts.join('\n')
  })

  return {
    content: [{
      type: 'text',
      text: `Found ${memories.length} memories for "${query}" (${method}):\n\n${lines.join('\n\n')}`,
    }],
  }
}
