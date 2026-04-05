import type { SqliteCache } from '../cache/sqlite'

export interface StatsDetailResult {
  total: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  avgConfidence: number
  topAgents: Array<{ name: string; count: number }>
}

export function computeStatsDetail(projectId: string, cache: SqliteCache): StatsDetailResult {
  const all = cache.getAllForProject(projectId)

  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const agentCounts: Record<string, number> = {}
  let confidenceSum = 0

  for (const m of all) {
    byType[m.type] = (byType[m.type] || 0) + 1
    byStatus[m.status] = (byStatus[m.status] || 0) + 1
    confidenceSum += m.confidence ?? 1
    if (m.agentName) {
      agentCounts[m.agentName] = (agentCounts[m.agentName] || 0) + 1
    }
  }

  const avgConfidence = all.length > 0 ? confidenceSum / all.length : 0

  const topAgents = Object.entries(agentCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  return {
    total: all.length,
    byType,
    byStatus,
    avgConfidence,
    topAgents,
  }
}

export async function handleStatsDetail(
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const stats = computeStatsDetail(projectId, cache)

  const typeLines = Object.entries(stats.byType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `  ${type}: ${count}`)
    .join('\n')

  const statusLines = Object.entries(stats.byStatus)
    .map(([status, count]) => `  ${status}: ${count}`)
    .join('\n')

  const agentLines = stats.topAgents.length > 0
    ? stats.topAgents.map((a) => `  ${a.name}: ${a.count}`).join('\n')
    : '  (none)'

  return {
    content: [{
      type: 'text',
      text: [
        '## Memory Stats (Detail)',
        '',
        `Total: ${stats.total}`,
        `Average confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`,
        '',
        'By type:',
        typeLines || '  (none)',
        '',
        'By status:',
        statusLines || '  (none)',
        '',
        'Top agents:',
        agentLines,
      ].join('\n'),
    }],
  }
}
