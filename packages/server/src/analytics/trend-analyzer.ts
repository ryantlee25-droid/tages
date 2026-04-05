import type { SessionRecord } from './session-recorder'
import { computeAgentMetrics } from './metrics-computer'

export interface TrendReport {
  agentName: string
  sessions: number
  recallHitRateTrend: number    // positive = improving, negative = declining
  violationTrend: number
  memoriesCreatedTrend: number
  insights: string[]
}

/**
 * Compare current session to last N sessions and detect trends.
 */
export function computeTrends(
  allSessions: SessionRecord[],
  agentName?: string,
  lookbackCount = 5,
): TrendReport {
  const filtered = agentName
    ? allSessions.filter(s => s.agentName === agentName)
    : allSessions

  if (filtered.length < 2) {
    return {
      agentName: agentName || 'all',
      sessions: filtered.length,
      recallHitRateTrend: 0,
      violationTrend: 0,
      memoriesCreatedTrend: 0,
      insights: ['Not enough sessions for trend analysis (need 2+)'],
    }
  }

  // Sort by start time
  const sorted = [...filtered].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  )

  const recent = sorted.slice(-1)[0]
  const historical = sorted.slice(-(lookbackCount + 1), -1)

  const currentMetrics = computeAgentMetrics([recent], agentName)
  const historicalMetrics = computeAgentMetrics(historical, agentName)

  const recallHitRateTrend = currentMetrics.avgRecallHitRate - historicalMetrics.avgRecallHitRate
  const violationTrend = currentMetrics.totalConventionViolations - historicalMetrics.totalConventionViolations / Math.max(historical.length, 1)
  const memoriesCreatedTrend = currentMetrics.totalMemoriesCreated - historicalMetrics.totalMemoriesCreated / Math.max(historical.length, 1)

  const insights: string[] = []

  if (recallHitRateTrend > 0.1) {
    insights.push(`Recall hit rate improved ${(recallHitRateTrend * 100).toFixed(0)}% — memory store is becoming more useful`)
  } else if (recallHitRateTrend < -0.1) {
    insights.push(`Recall hit rate declined ${(Math.abs(recallHitRateTrend) * 100).toFixed(0)}% — consider storing more specific memories`)
  }

  if (violationTrend > 1) {
    insights.push(`Convention violations increased by ${violationTrend.toFixed(0)} — review recent convention memories`)
  } else if (violationTrend < -1) {
    insights.push(`Convention violations decreased — convention compliance improving`)
  }

  if (memoriesCreatedTrend > 2) {
    insights.push(`Memory creation rate increased by ${memoriesCreatedTrend.toFixed(0)} — good knowledge capture`)
  }

  if (insights.length === 0) {
    insights.push('Performance is stable with no significant trends detected')
  }

  return {
    agentName: agentName || 'all',
    sessions: filtered.length,
    recallHitRateTrend,
    violationTrend,
    memoriesCreatedTrend,
    insights,
  }
}
