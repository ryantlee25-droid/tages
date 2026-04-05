import { globalSessionRecorder } from '../analytics/session-recorder'
import { computeAgentMetrics } from '../analytics/metrics-computer'
import { computeTrends } from '../analytics/trend-analyzer'

export async function handleSessionReplay(
  args: { sessionId: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const session = globalSessionRecorder.getSession(args.sessionId)
  if (!session) {
    return { content: [{ type: 'text', text: `Session "${args.sessionId}" not found.` }] }
  }

  const lines = [
    `Session: ${session.sessionId}`,
    `Agent: ${session.agentName || 'unknown'}  |  Started: ${session.startedAt}`,
    session.endedAt ? `Ended: ${session.endedAt}` : 'Status: active',
    '',
    `Timeline (${session.toolCalls.length} calls):`,
    ...session.toolCalls.map((call, i) =>
      `  ${i + 1}. [${call.timestamp.slice(11, 19)}] ${call.toolName}(${JSON.stringify(call.args).slice(0, 40)}) → ${call.resultSummary.slice(0, 60)} (${call.durationMs}ms)`
    ),
  ]

  if (session.metrics) {
    lines.push(
      '',
      'Session Metrics:',
      `  Recall hit rate: ${(session.metrics.recallHitRate * 100).toFixed(0)}%`,
      `  Memories created: ${session.metrics.memoriesCreated}`,
      `  Convention violations: ${session.metrics.conventionViolations}`,
      `  Duration: ${(session.metrics.durationMs / 1000).toFixed(1)}s`,
    )
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleAgentMetrics(
  args: { agentName?: string },
  projectId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const sessions = globalSessionRecorder.getAllSessions(projectId)
  const metrics = computeAgentMetrics(sessions, args.agentName)

  const lines = [
    `Agent Metrics${args.agentName ? ` for "${args.agentName}"` : ' (all agents)'}:`,
    `  Overall score:     ${metrics.overallScore}/100`,
    `  Sessions:          ${metrics.sessionCount}`,
    `  Recall hit rate:   ${(metrics.avgRecallHitRate * 100).toFixed(0)}%`,
    `  Memories created:  ${metrics.totalMemoriesCreated}`,
    `  Violations:        ${metrics.totalConventionViolations}`,
    `  Avg duration:      ${(metrics.avgSessionDurationMs / 1000).toFixed(1)}s`,
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleTrends(
  args: { agentName?: string },
  projectId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const sessions = globalSessionRecorder.getAllSessions(projectId)
  const report = computeTrends(sessions, args.agentName)

  const trendArrow = (n: number) => n > 0.05 ? '↑' : n < -0.05 ? '↓' : '→'

  const lines = [
    `Trend Analysis${args.agentName ? ` for "${args.agentName}"` : ''}:`,
    `  Sessions analyzed: ${report.sessions}`,
    `  Recall hit rate:   ${trendArrow(report.recallHitRateTrend)} ${(report.recallHitRateTrend * 100).toFixed(0)}%`,
    `  Violations:        ${trendArrow(-report.violationTrend)} ${report.violationTrend.toFixed(1)}`,
    `  Memories/session:  ${trendArrow(report.memoriesCreatedTrend)} ${report.memoriesCreatedTrend.toFixed(1)}`,
    '',
    'Insights:',
    ...report.insights.map(i => `  - ${i}`),
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
