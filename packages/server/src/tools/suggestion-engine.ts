import type { SqliteCache } from '../cache/sqlite'
import type { QueryLog, MissPattern } from '../cache/query-log'

interface Suggestion {
  topic: string
  queries: string[]
  missCount: number
  confidence: number
  suggestion: string
}

function clusterByPrefix(patterns: MissPattern[]): Map<string, MissPattern[]> {
  const clusters = new Map<string, MissPattern[]>()

  for (const p of patterns) {
    const words = p.query.split(/\s+/).filter(Boolean)
    // Use first meaningful word as cluster key
    const key = words[0] || p.query
    const existing = clusters.get(key) || []
    existing.push(p)
    clusters.set(key, existing)
  }

  return clusters
}

export function computeSuggestions(patterns: MissPattern[]): Suggestion[] {
  if (patterns.length === 0) return []

  const clusters = clusterByPrefix(patterns)
  const suggestions: Suggestion[] = []

  for (const [topic, group] of clusters) {
    const totalMisses = group.reduce((sum, p) => sum + p.count, 0)
    const queries = group.map((p) => p.query)
    // Confidence scales with miss count — more misses = more useful to store
    const confidence = Math.min(1.0, totalMisses / 10)

    suggestions.push({
      topic,
      queries,
      missCount: totalMisses,
      confidence,
      suggestion: `Store a memory about "${topic}" — searched ${totalMisses} time${totalMisses === 1 ? '' : 's'} without results (e.g., "${queries[0]}")`,
    })
  }

  return suggestions.sort((a, b) => b.missCount - a.missCount)
}

export async function handleSuggestions(
  projectId: string,
  cache: SqliteCache,
  queryLog: QueryLog,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const patterns = queryLog.getTopMissPatterns(projectId, 20)
  const suggestions = computeSuggestions(patterns)

  if (suggestions.length === 0) {
    return {
      content: [{
        type: 'text',
        text: 'No suggestions yet — no recall misses recorded. Use recall to build up miss history.',
      }],
    }
  }

  const lines = suggestions.slice(0, 10).map((s, i) =>
    `${i + 1}. ${s.suggestion} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
  )

  return {
    content: [{
      type: 'text',
      text: [
        `## Memory Suggestions (${suggestions.length})`,
        '',
        'Based on queries that returned no results:',
        '',
        ...lines,
      ].join('\n'),
    }],
  }
}
