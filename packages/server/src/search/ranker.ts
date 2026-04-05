/**
 * Unified search ranking for recall results.
 *
 * Combines semantic (embedding cosine similarity) and text (LIKE match) scores
 * into a single composite score with configurable weights. Also applies recency
 * boost and confidence weighting.
 */
import type { Memory } from '@tages/shared'

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
): number {
  const cfg = { ...DEFAULTS, ...config }

  // Weighted blend of semantic and text scores
  const blendedScore =
    semanticScore * cfg.semanticWeight +
    textScore * cfg.textWeight

  // Apply confidence weighting: high confidence memories rank higher
  // confidenceWeight of 0.3 means confidence contributes 30% of final adjustment
  const confidenceAdjustment = 1 + (memory.confidence - 0.5) * cfg.confidenceWeight

  // Apply recency boost for recently updated memories
  const updatedAt = new Date(memory.updatedAt).getTime()
  const cutoff = Date.now() - cfg.recencyBoostDays * 24 * 60 * 60 * 1000
  const recencyMultiplier = updatedAt > cutoff ? cfg.recencyBoostFactor : 1.0

  return blendedScore * confidenceAdjustment * recencyMultiplier
}

/**
 * Rank a list of scored memories by composite score, deduplicate by id.
 * Returns Memory[] in descending score order.
 */
export function rankResults(results: ScoredMemory[], config: RankerConfig = {}): Memory[] {
  if (results.length === 0) return []

  // Score each result
  const scored = results.map(r => ({
    memory: r.memory,
    score: combineScores(r.semanticScore, r.textScore, r.memory, config),
  }))

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
