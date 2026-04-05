import type { Memory } from '@tages/shared'

export interface DuplicatePair {
  memoryA: Memory
  memoryB: Memory
  score: number
  suggestedMergedValue: string
}

/**
 * Tokenize text into a set of lowercase words for Jaccard similarity.
 */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2),
  )
}

/**
 * Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const intersection = new Set([...a].filter(t => b.has(t)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Pick the more detailed of two values (longer wins, ties go to b).
 */
function pickMoreDetailed(a: string, b: string): string {
  return a.length >= b.length ? a : b
}

/**
 * Given a set of memories, detect near-duplicate pairs with Jaccard >= threshold.
 * Only compares memories of the same type.
 * Returns pairs sorted by score descending.
 */
export function detectDuplicates(
  memories: Memory[],
  threshold = 0.7,
): DuplicatePair[] {
  const live = memories.filter(m => m.status === 'live')
  const pairs: DuplicatePair[] = []
  const seen = new Set<string>()

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]

      // Only compare same type to avoid false positives across domains
      if (a.type !== b.type) continue

      const pairKey = [a.id, b.id].sort().join('|')
      if (seen.has(pairKey)) continue
      seen.add(pairKey)

      const tokensA = tokenSet(`${a.key} ${a.value}`)
      const tokensB = tokenSet(`${b.key} ${b.value}`)
      const score = jaccardSimilarity(tokensA, tokensB)

      if (score >= threshold) {
        pairs.push({
          memoryA: a,
          memoryB: b,
          score,
          suggestedMergedValue: pickMoreDetailed(a.value, b.value),
        })
      }
    }
  }

  return pairs.sort((a, b) => b.score - a.score)
}
