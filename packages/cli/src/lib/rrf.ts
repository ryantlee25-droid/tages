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
 * Ties on the fused score break on `updated_at` DESC, then `id` ASC (0.5.7,
 * bug 10). Before this a tie kept Map insertion order, i.e. whatever order the
 * RPCs happened to return, so two memories with identical text could swap
 * places between runs. The server ranker and the server's SQLite query use the
 * same rule.
 *
 * Designed from the start to accept a variable number of ranked lists (2, 3,
 * 4, ...) since later tasks (temporal channel, chunk-semantic channel) each
 * add another list to the same fusion call site in recall.ts.
 */

const DEFAULT_K = 60

export interface FusedItem<T> {
  item: T
  score: number
}

interface TimedRow {
  id: string
  updated_at?: unknown
  created_at?: unknown
}

/** Millisecond timestamp of a row's last write; 0 when absent or unparsable. */
export function rowWriteTime(row: { updated_at?: unknown; created_at?: unknown }): number {
  const raw = row.updated_at ?? row.created_at
  if (typeof raw !== 'string' && !(raw instanceof Date)) return 0
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Deterministic tiebreak for two rows of equal relevance: newer `updated_at`
 * first (falling back to `created_at`), then `id` ascending.
 */
export function compareNewestThenId(a: TimedRow, b: TimedRow): number {
  const diff = rowWriteTime(b) - rowWriteTime(a)
  if (diff !== 0) return diff
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** RRF fusion that also returns each item's summed score, best first. */
export function reciprocalRankFusionScored<T extends { id: string }>(
  rankedLists: T[][],
  k: number = DEFAULT_K,
): FusedItem<T>[] {
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
    .map(([id, score]) => ({ item: rowData.get(id) as T, score }))
    .sort((a, b) => {
      const diff = b.score - a.score
      if (Math.abs(diff) > 1e-12) return diff
      return compareNewestThenId(a.item as TimedRow, b.item as TimedRow)
    })
}

export function reciprocalRankFusion<T extends { id: string }>(
  rankedLists: T[][],
  k: number = DEFAULT_K,
): T[] {
  return reciprocalRankFusionScored(rankedLists, k).map((f) => f.item)
}
