import type { SessionRecord, SessionMetrics } from './session-recorder'

export interface AgentMetrics {
  agentName: string
  sessionCount: number
  avgRecallHitRate: number
  avgCreateToVerifyRatio: number
  totalMemoriesCreated: number
  totalConventionViolations: number
  avgSessionDurationMs: number
  overallScore: number  // 0-100 composite
}

/**
 * Compute aggregated metrics across all sessions for a given agent.
 */
export function computeAgentMetrics(sessions: SessionRecord[], agentName?: string): AgentMetrics {
  const filtered = agentName
    ? sessions.filter(s => s.agentName === agentName)
    : sessions

  if (filtered.length === 0) {
    return {
      agentName: agentName || 'unknown',
      sessionCount: 0,
      avgRecallHitRate: 0,
      avgCreateToVerifyRatio: 0,
      totalMemoriesCreated: 0,
      totalConventionViolations: 0,
      avgSessionDurationMs: 0,
      overallScore: 0,
    }
  }

  const metricsArr = filtered
    .map(s => s.metrics)
    .filter((m): m is SessionMetrics => m !== undefined)

  const avg = (fn: (m: SessionMetrics) => number) =>
    metricsArr.length > 0
      ? metricsArr.reduce((sum, m) => sum + fn(m), 0) / metricsArr.length
      : 0

  const sum = (fn: (m: SessionMetrics) => number) =>
    metricsArr.reduce((s, m) => s + fn(m), 0)

  const avgRecallHitRate = avg(m => m.recallHitRate)
  const avgCreateToVerifyRatio = avg(m => m.createToVerifyRatio)
  const totalMemoriesCreated = sum(m => m.memoriesCreated)
  const totalConventionViolations = sum(m => m.conventionViolations)
  const avgSessionDurationMs = avg(m => m.durationMs)

  // Composite score: 40% recall rate + 30% (1 - violation rate) + 30% memory quality
  const violationRate = totalConventionViolations / Math.max(sum(m => m.totalCalls), 1)
  const overallScore = Math.round(
    (avgRecallHitRate * 40) +
    ((1 - Math.min(violationRate, 1)) * 30) +
    (Math.min(totalMemoriesCreated / 10, 1) * 30)
  )

  return {
    agentName: agentName || filtered[0].agentName || 'unknown',
    sessionCount: filtered.length,
    avgRecallHitRate,
    avgCreateToVerifyRatio,
    totalMemoriesCreated,
    totalConventionViolations,
    avgSessionDurationMs,
    overallScore,
  }
}
