/**
 * Multi-Hop Cross-Reference Recall
 *
 * Implements BFS graph traversal from crossSystemRefs with up to `depth` hops.
 * Returns neighbor memories ranked by relevance (confidence + ref distance).
 */
import type { Memory } from '@tages/shared'

/**
 * Build an adjacency map from crossSystemRefs.
 * Each memory's key maps to the keys it references.
 */
export function buildAdjacencyFromRefs(memories: Memory[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const mem of memories) {
    if (mem.crossSystemRefs && mem.crossSystemRefs.length > 0) {
      adj.set(mem.key, mem.crossSystemRefs)
    }
  }
  return adj
}

/**
 * Build a reverse lookup: key → Memory for fast access.
 */
function buildKeyIndex(memories: Memory[]): Map<string, Memory> {
  const idx = new Map<string, Memory>()
  for (const mem of memories) {
    idx.set(mem.key, mem)
  }
  return idx
}

/**
 * Expand recall results by traversing crossSystemRefs up to `depth` hops.
 *
 * @param seeds       - Initial recall results (hop 0)
 * @param allMemories - Full memory pool to traverse
 * @param depth       - Number of hops (0 = seeds only, 1 = direct refs, 2 = refs-of-refs)
 * @returns Memories ranked by relevance: seeds first, then neighbors in BFS order by confidence
 */
export function expandRecall(
  seeds: Memory[],
  allMemories: Memory[],
  depth: number,
): Memory[] {
  if (depth === 0 || seeds.length === 0) return seeds

  const keyIndex = buildKeyIndex(allMemories)
  const adj = buildAdjacencyFromRefs(allMemories)

  // BFS from seed keys
  const visited = new Set<string>()
  const result: Array<{ memory: Memory; hop: number }> = []

  // Add seeds as hop 0
  for (const seed of seeds) {
    if (!visited.has(seed.key)) {
      visited.add(seed.key)
      result.push({ memory: seed, hop: 0 })
    }
  }

  // BFS frontier
  let frontier = seeds.map(s => s.key)

  for (let hop = 1; hop <= depth; hop++) {
    const nextFrontier: string[] = []

    for (const key of frontier) {
      const refs = adj.get(key) || []
      for (const refKey of refs) {
        if (!visited.has(refKey)) {
          visited.add(refKey)
          const neighbor = keyIndex.get(refKey)
          if (neighbor) {
            result.push({ memory: neighbor, hop })
            nextFrontier.push(refKey)
          }
        }
      }
    }

    frontier = nextFrontier
    if (frontier.length === 0) break
  }

  // Sort: hop 0 first, then by confidence desc within each hop level
  result.sort((a, b) => {
    if (a.hop !== b.hop) return a.hop - b.hop
    return b.memory.confidence - a.memory.confidence
  })

  return result.map(r => r.memory)
}
