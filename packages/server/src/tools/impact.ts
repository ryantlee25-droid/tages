import type { SqliteCache } from '../cache/sqlite'
import { computeImpactReport, computeProjectRisk } from '../graph/impact-scorer'
import { analyzeGraph } from '../graph/dependency-analyzer'

export async function handleImpactAnalysis(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return { content: [{ type: 'text', text: `Memory "${args.key}" not found.` }] }
  }

  const allMemories = cache.getAllForProject(projectId)
  const report = computeImpactReport(memory, allMemories)

  const lines = [
    `Impact analysis for "${args.key}":`,
    `  Risk level: ${report.riskLevel.toUpperCase()} (score: ${report.riskScore.toFixed(2)})`,
    `  Direct dependents: ${report.directDependents.length}`,
  ]

  if (report.directDependents.length > 0) {
    lines.push(`  Dependents: ${report.directDependents.join(', ')}`)
  }
  lines.push(`  Transitive impact: ${report.transitiveCount} downstream memories`)

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleRiskReport(
  args: Record<string, never>,
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memories = cache.getAllForProject(projectId)
  const report = computeProjectRisk(memories)

  if (memories.length === 0) {
    return { content: [{ type: 'text', text: 'No memories found for risk analysis.' }] }
  }

  const top10 = report.rankedByRisk.slice(0, 10)
  const lines = [
    `Project Risk Report (${report.totalMemories} memories):`,
    `  High/critical risk: ${report.highRiskCount}  |  Orphaned: ${report.orphanCount}`,
    '',
    'Top risky memories:',
    ...top10.map((r, i) =>
      `  ${i + 1}. [${r.riskLevel.toUpperCase()}] "${r.key}" — ${r.transitiveCount} downstream, score: ${r.riskScore.toFixed(2)}`
    ),
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleGraphAnalysis(
  _args: Record<string, never>,
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memories = cache.getAllForProject(projectId)
  const analysis = analyzeGraph(memories)

  const lines = [
    `Dependency graph for project (${memories.length} memories):`,
    `  Nodes: ${analysis.graph.nodes.size}`,
    `  Orphans: ${analysis.orphans.length}`,
  ]

  if (analysis.orphans.length > 0) {
    lines.push(`  Orphan keys: ${analysis.orphans.slice(0, 10).join(', ')}${analysis.orphans.length > 10 ? '...' : ''}`)
  }

  if (analysis.criticalPaths.length > 0) {
    lines.push('  Longest chains:')
    for (const path of analysis.criticalPaths.slice(0, 3)) {
      lines.push(`    ${path.join(' → ')}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
