import type { Memory } from '@tages/shared'

export interface ScoredMemory {
  memory: Memory
  score: number
}

/**
 * Score a single memory using composite formula:
 * confidence × 0.4 + recency × 0.3 + accessFrequency × 0.3
 */
export function scoreMemory(
  memory: Memory,
  accessCount: number,
  maxAccessCount: number,
): number {
  const confidence = memory.confidence ?? 0.5

  // Recency: 1.0 = updated today, 0.0 = updated 90+ days ago
  const daysSinceUpdate = (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  const recency = Math.max(0, 1 - daysSinceUpdate / 90)

  // Access frequency: normalized 0-1 relative to most-accessed memory
  const accessFrequency = maxAccessCount > 0 ? accessCount / maxAccessCount : 0

  return confidence * 0.4 + recency * 0.3 + accessFrequency * 0.3
}

/**
 * Score and sort memories by composite score descending.
 * Stable tie-break: updatedAt descending, then id lexicographic.
 */
export function scoreAndSort(
  memories: Memory[],
  accessCounts: Map<string, number>,
): ScoredMemory[] {
  const maxAccessCount = Math.max(...Array.from(accessCounts.values()), 0)

  return memories
    .map(memory => ({
      memory,
      score: scoreMemory(memory, accessCounts.get(memory.id) || 0, maxAccessCount),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      // Stable tie-break: most recently updated first
      if (a.memory.updatedAt !== b.memory.updatedAt) {
        return b.memory.updatedAt.localeCompare(a.memory.updatedAt)
      }
      return a.memory.id.localeCompare(b.memory.id)
    })
}
