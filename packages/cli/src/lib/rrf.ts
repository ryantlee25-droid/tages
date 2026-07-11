/**
 * Reciprocal Rank Fusion (RRF) for merging multiple ranked candidate lists
 * (trigram, semantic, temporal, chunk-semantic, ...) into a single fused
 * ranking, replacing the CLI's previous raw-similarity-score merge (PLAN.md
 * Task 1).
 *
 * For each list, the item at 1-based rank `r` contributes `1/(k+r)` to that
 * item's fused score; contributions across lists are summed (an id absent
 * from a list simply contributes 0 from it, never an error). Results are
 * sorted by summed score descending.
 *
 * Designed from the start to accept a variable number of ranked lists (2, 3,
 * 4, ...) since later tasks (temporal channel, chunk-semantic channel) each
 * add another list to the same fusion call site in recall.ts.
 */

const DEFAULT_K = 60

export function reciprocalRankFusion<T extends { id: string }>(
  rankedLists: T[][],
  k: number = DEFAULT_K,
): T[] {
  const scores = new Map<string, number>()
  const rowData = new Map<string, T>()
  const bestRank = new Map<string, number>()

  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const rank = index + 1 // 1-based rank
      const id = item.id
      const contribution = 1 / (k + rank)
      scores.set(id, (scores.get(id) ?? 0) + contribution)

      // Merge row data preferring whichever list ranked this id higher
      // (lower rank number wins), mirroring the "semantic results first"
      // tie-break the previous merge logic used in recall.ts. Ties (same
      // best rank across lists) keep whichever list was passed first.
      const currentBest = bestRank.get(id)
      if (currentBest === undefined || rank < currentBest) {
        bestRank.set(id, rank)
        rowData.set(id, item)
      }
    })
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => rowData.get(id) as T)
}
