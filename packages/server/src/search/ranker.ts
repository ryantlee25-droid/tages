/**
 * Unified search ranking for recall results.
 *
 * Combines semantic (embedding cosine similarity) and text (LIKE match) scores
 * into a single composite score with configurable weights. Also applies recency
 * boost and confidence weighting.
 *
 * Temporal anchoring (migration 0060): when the query looks temporal
 * (isTemporalQuery), results are additionally reordered by proximity to (or
 * recency of) `referencedDate ?? relativeDate ?? createdAt`, layered on top
 * of — not replacing — the composite score above. Non-temporal queries are
 * unaffected: the `query` parameter is optional and everything below is a
 * no-op when it's omitted or not temporal.
 */
import type { Memory } from '@tages/shared'
import { isTemporalQuery, extractTargetDate } from './temporal-query'

export interface ScoredMemory {
  memory: Memory
  semanticScore: number // 0–1 cosine similarity (0 if not applicable)
  textScore: number     // 0–1 text match quality (0 if not applicable)
}

export interface RankerConfig {
  semanticWeight?: number  // default 0.6
  textWeight?: number      // default 0.4
  confidenceWeight?: number // multiply final score by confidence (0–1 factor), default 0.3
  recencyBoostDays?: number // boost memories updated within N days, default 30
  recencyBoostFactor?: number // multiplier for recent memories, default 1.15
}

const DEFAULTS: Required<RankerConfig> = {
  semanticWeight: 0.6,
  textWeight: 0.4,
  confidenceWeight: 0.3,
  recencyBoostDays: 30,
  recencyBoostFactor: 1.15,
}

/**
 * Combine semantic and text scores into a single composite score.
 * Applies confidence weighting and recency boost.
 */
export function combineScores(
  semanticScore: number,
  textScore: number,
  memory: Memory,
  config: RankerConfig = {},
  applyRecencyBoost = true,
): number {
  const cfg = { ...DEFAULTS, ...config }

  // Weighted blend of semantic and text scores
  const blendedScore =
    semanticScore * cfg.semanticWeight +
    textScore * cfg.textWeight

  // Apply confidence weighting: high confidence memories rank higher
  // confidenceWeight of 0.3 means confidence contributes 30% of final adjustment
  const confidenceAdjustment = 1 + (memory.confidence - 0.5) * cfg.confidenceWeight

  // Apply recency boost for recently updated memories. Skipped by the temporal
  // recency branch of rankResults, which rewards recency itself via the
  // proximity factor — applying both would double-count write-recency.
  let recencyMultiplier = 1.0
  if (applyRecencyBoost) {
    const updatedAt = new Date(memory.updatedAt).getTime()
    const cutoff = Date.now() - cfg.recencyBoostDays * 24 * 60 * 60 * 1000
    recencyMultiplier = updatedAt > cutoff ? cfg.recencyBoostFactor : 1.0
  }

  return blendedScore * confidenceAdjustment * recencyMultiplier
}

const TEMPORAL_WEIGHT = 0.5

/**
 * Proximity of a memory's temporal anchor to a comparison instant, in the
 * range (0, 1]. Uses the fallback chain referencedDate -> relativeDate ->
 * createdAt (every memory has createdAt, so this never returns 0 for a
 * valid memory). When `targetDate` is given (the query itself named a date),
 * proximity favors memories close to that date; otherwise it favors recency
 * relative to `anchor` (now).
 */
function temporalProximity(memory: Memory, anchor: Date, targetDate?: Date): number {
  const dateStr = memory.referencedDate ?? memory.relativeDate ?? memory.createdAt
  if (!dateStr) return 0
  const memTime = new Date(dateStr).getTime()
  if (Number.isNaN(memTime)) return 0
  const compareTime = (targetDate ?? anchor).getTime()
  const diffDays = Math.abs(compareTime - memTime) / (24 * 60 * 60 * 1000)
  return 1 / (1 + diffDays)
}

/**
 * Rank a list of scored memories by composite score, deduplicate by id.
 * Returns Memory[] in descending score order.
 *
 * `query` is optional — when provided and temporal (isTemporalQuery), the
 * composite score is multiplied by a temporal-proximity factor before
 * sorting. Omitting `query` (or a non-temporal query) leaves ranking
 * unchanged from before this parameter existed.
 */
export function rankResults(results: ScoredMemory[], config: RankerConfig = {}, query?: string): Memory[] {
  if (results.length === 0) return []

  const temporal = !!query && isTemporalQuery(query)
  const anchor = new Date()
  const targetDate = temporal ? extractTargetDate(query!, anchor) : undefined

  // In temporal RECENCY mode (temporal query with no explicit target date) the
  // proximity factor below already rewards recency relative to `now`, so the
  // separate updatedAt recency boost inside combineScores is disabled to avoid
  // double-counting write-recency. When the query names a concrete date
  // (targetDate set), proximity-to-that-date is an independent signal, so the
  // recency boost stays on.
  const applyRecencyBoost = !(temporal && !targetDate)

  // Score each result
  const scored = results.map(r => {
    const base = combineScores(r.semanticScore, r.textScore, r.memory, config, applyRecencyBoost)
    const score = temporal
      ? base * (1 + TEMPORAL_WEIGHT * temporalProximity(r.memory, anchor, targetDate))
      : base
    return { memory: r.memory, score }
  })

  // Sort descending, stable tie-breaking by updatedAt then id
  scored.sort((a, b) => {
    const diff = b.score - a.score
    if (Math.abs(diff) > 1e-10) return diff
    // Tie-break: newer updatedAt wins
    const timeA = new Date(a.memory.updatedAt).getTime()
    const timeB = new Date(b.memory.updatedAt).getTime()
    if (timeA !== timeB) return timeB - timeA
    // Final tie-break: lexicographic by id for determinism
    return a.memory.id < b.memory.id ? -1 : 1
  })

  // Deduplicate by id (keep highest-scored occurrence)
  const seen = new Set<string>()
  const deduped: Memory[] = []
  for (const { memory } of scored) {
    if (!seen.has(memory.id)) {
      seen.add(memory.id)
      deduped.push(memory)
    }
  }

  return deduped
}

/**
 * Reciprocal-rank relevance signal derived from a row's position in an
 * already-relevance-sorted list: rank 0 -> 1.0, rank 1 -> 0.5, rank 2 -> 0.333.
 * The remote-hybrid and CLI recall paths get rows pre-sorted by the RPC's
 * similarity score but without the raw scores, so this reconstructs a
 * monotonic relevance value from position alone.
 */
export function relevanceFromRank(index: number): number {
  return 1 / (1 + index)
}

/**
 * Temporal proximity for the REORDER paths (remote-hybrid + CLI). Unlike the
 * local `temporalProximity`, this deliberately does NOT fall back to
 * `createdAt`: only a genuine content-anchored date (referencedDate /
 * relativeDate) counts. A row with neither returns 0 (no boost), so a
 * recently-WRITTEN but content-dateless row never competes on the same
 * proximity scale as a row whose text actually referenced a date. Range
 * [0, 1]; higher = closer to the comparison instant.
 *
 * Exported (PLAN.md Task 7) so `search/temporal-channel.ts` can rank its own
 * date-range candidates with the exact same formula, rather than duplicating
 * it — both call sites operate on the same "content-anchored date only, no
 * createdAt fallback" semantics.
 */
export function reorderProximity(memory: Memory, anchor: Date, targetDate?: Date): number {
  const dateStr = memory.referencedDate ?? memory.relativeDate
  if (!dateStr) return 0
  const memTime = new Date(dateStr).getTime()
  if (Number.isNaN(memTime)) return 0
  const compareTime = (targetDate ?? anchor).getTime()
  const diffDays = Math.abs(compareTime - memTime) / (24 * 60 * 60 * 1000)
  return 1 / (1 + diffDays)
}

/**
 * Reorder already-ranked remote results when the query is temporal, preserving
 * relevance as the primary signal. Used for the remote-hybrid recall path
 * (SupabaseSync.remoteHybridRecall): rows arrive pre-sorted by the
 * `hybrid_recall` RPC's similarity score but without the score breakdown
 * `rankResults` needs, so relevance is reconstructed from rank position and a
 * BOUNDED multiplicative proximity boost (`1 + TEMPORAL_WEIGHT * proximity`,
 * mirroring the local path) is layered on top.
 *
 * Because the boost is bounded to [1, 1.5], a substantially-more-relevant
 * memory can never be demoted below a barely-closer-dated one, and the top
 * similarity hit (relevance 1.0) can never be overtaken (the best any lower
 * rank can reach is 0.5 * 1.5 = 0.75). Only content-dated rows are boosted
 * (see reorderProximity); non-temporal queries return `memories` unchanged.
 */
export function reorderByTemporalProximity(memories: Memory[], query: string): Memory[] {
  if (memories.length === 0 || !isTemporalQuery(query)) return memories

  const anchor = new Date()
  const targetDate = extractTargetDate(query, anchor)

  return memories
    .map((memory, index) => {
      const proximity = reorderProximity(memory, anchor, targetDate)
      const score = relevanceFromRank(index) * (1 + TEMPORAL_WEIGHT * proximity)
      return { memory, index, score }
    })
    .sort((a, b) => {
      const diff = b.score - a.score
      if (Math.abs(diff) > 1e-10) return diff
      // Stable: preserve the RPC's original relevance order on a score tie.
      return a.index - b.index
    })
    .map(r => r.memory)
}

/**
 * Convert plain memories (no scores) into ScoredMemory with textScore = 1 and semanticScore = 0.
 * Used when only text search results are available.
 */
export function asTextResults(memories: Memory[]): ScoredMemory[] {
  return memories.map(m => ({ memory: m, semanticScore: 0, textScore: 1 }))
}

/**
 * Convert semantic search results to ScoredMemory with textScore = 0.
 */
export function asSemanticResults(memories: Memory[], scores: number[]): ScoredMemory[] {
  return memories.map((m, i) => ({
    memory: m,
    semanticScore: scores[i] ?? 0,
    textScore: 0,
  }))
}
