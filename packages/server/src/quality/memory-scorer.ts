import type { Memory } from '@tages/shared'

export interface QualityScore {
  total: number         // 0-100
  completeness: number  // 0-25
  freshness: number     // 0-25
  consistency: number   // 0-25
  usefulness: number    // 0-25
  breakdown: {
    hasConditions: boolean
    hasExamples: boolean
    hasCrossRefs: boolean
    hasTags: boolean
    hasFilePaths: boolean
    freshnessAgeDays: number
    hasContradictions: boolean
    recallHitRate: number
  }
}

export interface ProjectHealth {
  averageScore: number
  distribution: { excellent: number; good: number; fair: number; poor: number }
  worstMemories: Array<{ key: string; score: number }>
  suggestions: string[]
}

/**
 * Score a memory on completeness (0-25):
 * - +5 for conditions, +5 for examples, +5 for crossSystemRefs, +5 for tags, +5 for filePaths
 */
function scoreCompleteness(mem: Memory): { score: number; breakdown: Partial<QualityScore['breakdown']> } {
  let score = 0
  const hasConditions = (mem.conditions?.length ?? 0) > 0
  const hasExamples = (mem.examples?.length ?? 0) > 0
  const hasCrossRefs = (mem.crossSystemRefs?.length ?? 0) > 0
  const hasTags = (mem.tags?.length ?? 0) > 0
  const hasFilePaths = (mem.filePaths?.length ?? 0) > 0

  if (hasConditions) score += 5
  if (hasExamples) score += 5
  if (hasCrossRefs) score += 5
  if (hasTags) score += 5
  if (hasFilePaths) score += 5

  return {
    score,
    breakdown: { hasConditions, hasExamples, hasCrossRefs, hasTags, hasFilePaths },
  }
}

/**
 * Score freshness (0-25):
 * 25 if updated in last 7 days, decay linearly to 0 at 180 days.
 */
function scoreFreshness(mem: Memory, nowMs = Date.now()): { score: number; ageDays: number } {
  const ageDays = (nowMs - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  const score = Math.max(0, Math.round(25 * (1 - Math.min(ageDays / 180, 1))))
  return { score, ageDays }
}

/**
 * Score consistency (0-25):
 * 25 if no contradictions, 0 if contradictions found.
 * Uses simple negation detection against same-type memories.
 */
function scoreConsistency(mem: Memory, allMemories: Memory[]): { score: number; hasContradictions: boolean } {
  const positiveMarkers = ['always', 'must', 'should', 'required', 'use']
  const negativeMarkers = ['never', 'avoid', 'must not', 'do not', 'dont']

  const memLower = mem.value.toLowerCase()
  const memIsPositive = positiveMarkers.some(m => memLower.includes(m))
  const memIsNegative = negativeMarkers.some(m => memLower.includes(m))

  for (const other of allMemories) {
    if (other.id === mem.id || other.type !== mem.type) continue
    const otherLower = other.value.toLowerCase()
    const otherIsPositive = positiveMarkers.some(m => otherLower.includes(m))
    const otherIsNegative = negativeMarkers.some(m => otherLower.includes(m))

    // Check token overlap to see if they're about the same thing
    const tokA = new Set(mem.value.toLowerCase().split(/\s+/).filter(t => t.length > 2))
    const tokB = new Set(other.value.toLowerCase().split(/\s+/).filter(t => t.length > 2))
    const overlap = [...tokA].filter(t => tokB.has(t)).length / Math.max(tokA.size, tokB.size, 1)

    if (overlap > 0.3) {
      if ((memIsPositive && otherIsNegative) || (memIsNegative && otherIsPositive)) {
        return { score: 0, hasContradictions: true }
      }
    }
  }

  return { score: 25, hasContradictions: false }
}

/**
 * Score usefulness (0-25):
 * Based on confidence (0-15) and value length (0-10).
 */
function scoreUsefulness(mem: Memory): { score: number; recallHitRate: number } {
  const confScore = Math.round(mem.confidence * 15)
  const lengthScore = Math.min(Math.round(mem.value.length / 20), 10)
  return {
    score: confScore + lengthScore,
    recallHitRate: mem.confidence,
  }
}

export function scoreMemory(mem: Memory, allMemories: Memory[] = [], nowMs = Date.now()): QualityScore {
  const comp = scoreCompleteness(mem)
  const fresh = scoreFreshness(mem, nowMs)
  const consist = scoreConsistency(mem, allMemories)
  const useful = scoreUsefulness(mem)

  const total = comp.score + fresh.score + consist.score + useful.score

  return {
    total,
    completeness: comp.score,
    freshness: fresh.score,
    consistency: consist.score,
    usefulness: useful.score,
    breakdown: {
      hasConditions: comp.breakdown.hasConditions ?? false,
      hasExamples: comp.breakdown.hasExamples ?? false,
      hasCrossRefs: comp.breakdown.hasCrossRefs ?? false,
      hasTags: comp.breakdown.hasTags ?? false,
      hasFilePaths: comp.breakdown.hasFilePaths ?? false,
      freshnessAgeDays: fresh.ageDays,
      hasContradictions: consist.hasContradictions,
      recallHitRate: useful.recallHitRate,
    },
  }
}

export function computeProjectHealth(memories: Memory[]): ProjectHealth {
  if (memories.length === 0) {
    return {
      averageScore: 0,
      distribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
      worstMemories: [],
      suggestions: ['Add your first memories to get started'],
    }
  }

  const live = memories.filter(m => m.status === 'live')
  const scores = live.map(mem => ({ key: mem.key, score: scoreMemory(mem, live).total }))

  const avg = scores.reduce((sum, s) => sum + s.score, 0) / scores.length
  const dist = { excellent: 0, good: 0, fair: 0, poor: 0 }
  for (const s of scores) {
    if (s.score >= 80) dist.excellent++
    else if (s.score >= 60) dist.good++
    else if (s.score >= 40) dist.fair++
    else dist.poor++
  }

  const worst = scores.sort((a, b) => a.score - b.score).slice(0, 5)
  const suggestions: string[] = []

  const noExamples = live.filter(m => !m.examples?.length).length
  if (noExamples > live.length * 0.5) suggestions.push(`${noExamples} memories lack examples — add concrete examples to improve quality`)

  const noConditions = live.filter(m => !m.conditions?.length).length
  if (noConditions > live.length * 0.5) suggestions.push(`${noConditions} memories lack conditions — specify when each convention applies`)

  const lowConf = live.filter(m => m.confidence < 0.7).length
  if (lowConf > 0) suggestions.push(`${lowConf} memories have low confidence — verify and update them`)

  return {
    averageScore: Math.round(avg),
    distribution: dist,
    worstMemories: worst,
    suggestions,
  }
}
