import type { Memory } from '@tages/shared'
import { buildDependencyGraph, computeImpactScores } from './dependency-analyzer'

export interface ImpactReport {
  key: string
  directDependents: string[]
  transitiveCount: number
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export interface ProjectRiskReport {
  rankedByRisk: ImpactReport[]
  totalMemories: number
  orphanCount: number
  highRiskCount: number
}

/**
 * Compute risk score for a single memory:
 * risk = impact * (1 - confidence) * staleness_factor
 * staleness_factor: 1 if not updated in >30 days, else proportional
 */
export function computeRisk(
  memory: Memory,
  impactCount: number,
  nowMs = Date.now(),
): number {
  const daysSinceUpdate = (nowMs - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  const stalenessFactor = Math.min(daysSinceUpdate / 30, 1.0)
  const inverseConfidence = 1 - memory.confidence
  return impactCount * (0.4 + inverseConfidence * 0.3 + stalenessFactor * 0.3)
}

function riskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 5) return 'critical'
  if (score >= 3) return 'high'
  if (score >= 1) return 'medium'
  return 'low'
}

export function computeImpactReport(
  memory: Memory,
  allMemories: Memory[],
): ImpactReport {
  const graph = buildDependencyGraph(allMemories)
  const impactScores = computeImpactScores(graph)

  const transitiveCount = impactScores.get(memory.key) ?? 0
  const directDependents = [...(graph.reverseEdges.get(memory.key) ?? new Set())]
  const riskScore = computeRisk(memory, transitiveCount)

  return {
    key: memory.key,
    directDependents,
    transitiveCount,
    riskScore,
    riskLevel: riskLevel(riskScore),
  }
}

export function computeProjectRisk(memories: Memory[]): ProjectRiskReport {
  const graph = buildDependencyGraph(memories)
  const impactScores = computeImpactScores(graph)

  const reports: ImpactReport[] = memories.map(mem => {
    const transitiveCount = impactScores.get(mem.key) ?? 0
    const directDependents = [...(graph.reverseEdges.get(mem.key) ?? new Set())]
    const riskScore = computeRisk(mem, transitiveCount)
    return {
      key: mem.key,
      directDependents,
      transitiveCount,
      riskScore,
      riskLevel: riskLevel(riskScore),
    }
  })

  const rankedByRisk = reports.sort((a, b) => b.riskScore - a.riskScore)
  const orphanCount = memories.filter(m => {
    const hasOut = (graph.edges.get(m.key)?.size ?? 0) > 0
    const hasIn = (graph.reverseEdges.get(m.key)?.size ?? 0) > 0
    return !hasOut && !hasIn
  }).length

  return {
    rankedByRisk,
    totalMemories: memories.length,
    orphanCount,
    highRiskCount: rankedByRisk.filter(r => r.riskLevel === 'high' || r.riskLevel === 'critical').length,
  }
}
