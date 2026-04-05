import type { Memory } from '@tages/shared'

export interface Contradiction {
  memoryA: Memory
  memoryB: Memory
  reason: string
}

export interface StaleRef {
  memory: Memory
  staleRef: string
  reason: string
}

/**
 * Find contradicting memories in a project.
 * A contradiction is when two same-type memories have negation conflict.
 */
export function findContradictions(memories: Memory[]): Contradiction[] {
  const positive = ['always', 'must', 'should', 'required', 'use', 'prefer']
  const negative = ['never', 'avoid', 'must not', 'do not', 'dont', 'prohibited']

  const contradictions: Contradiction[] = []
  const seen = new Set<string>()

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i]
      const b = memories[j]
      if (a.type !== b.type) continue

      const aLower = a.value.toLowerCase()
      const bLower = b.value.toLowerCase()
      const aPos = positive.some(m => aLower.includes(m))
      const aNeg = negative.some(m => aLower.includes(m))
      const bPos = positive.some(m => bLower.includes(m))
      const bNeg = negative.some(m => bLower.includes(m))

      if (!((aPos && bNeg) || (aNeg && bPos))) continue

      // Check token overlap
      const tokA = new Set(aLower.split(/\s+/).filter(t => t.length > 2))
      const tokB = new Set(bLower.split(/\s+/).filter(t => t.length > 2))
      const overlap = [...tokA].filter(t => tokB.has(t)).length / Math.max(tokA.size, tokB.size, 1)

      if (overlap < 0.25) continue

      const pairKey = [a.id, b.id].sort().join('|')
      if (seen.has(pairKey)) continue
      seen.add(pairKey)

      contradictions.push({
        memoryA: a,
        memoryB: b,
        reason: `"${a.key}" and "${b.key}" give conflicting guidance on the same topic`,
      })
    }
  }

  return contradictions
}

/**
 * Find cross-system refs that point to deleted or non-live memories.
 */
export function findStaleRefs(memories: Memory[], allMemories: Memory[]): StaleRef[] {
  const liveKeys = new Set(allMemories.filter(m => m.status === 'live').map(m => m.key))
  const stale: StaleRef[] = []

  for (const mem of memories) {
    for (const ref of mem.crossSystemRefs || []) {
      if (!liveKeys.has(ref)) {
        stale.push({
          memory: mem,
          staleRef: ref,
          reason: `crossSystemRef "${ref}" points to a non-existent or archived memory`,
        })
      }
    }
  }

  return stale
}
