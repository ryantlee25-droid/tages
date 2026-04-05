import type { SqliteCache } from '../cache/sqlite'
import { checkAgainstConventions } from '../enforcement/convention-checker'
import { globalViolationTracker } from '../enforcement/violation-tracker'

export async function handleCheckConvention(
  args: { key: string; agentName?: string },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return { content: [{ type: 'text', text: `Memory "${args.key}" not found.` }] }
  }

  const conventions = cache.getByType(projectId, 'convention')
  const result = checkAgainstConventions(memory, conventions)

  if (result.status === 'compliant') {
    return { content: [{ type: 'text', text: `Memory "${args.key}" is compliant with all conventions.` }] }
  }

  return {
    content: [{
      type: 'text',
      text: `Convention check for "${args.key}": ${result.status.toUpperCase()}\n${result.reason}`,
    }],
  }
}

export async function handleEnforcementReport(
  _args: Record<string, never>,
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const allMemories = cache.getAllForProject(projectId)
  const agentNames = [...new Set(allMemories.map(m => m.agentName).filter((n): n is string => !!n))]
  const report = globalViolationTracker.getReport(projectId, agentNames)

  const lines = [
    `Enforcement Report for project:`,
    `  Total violations: ${report.totalViolations}`,
    `  Total warnings: ${report.totalWarnings}`,
    '',
    'Agent compliance scores:',
    ...report.agentScores.map(a => `  ${a.agentName}: ${a.compliance}% compliant (${a.violations} violations, ${a.warnings} warnings)`),
  ]

  if (report.recentViolations.length > 0) {
    lines.push('', 'Recent violations:')
    for (const v of report.recentViolations.slice(0, 5)) {
      lines.push(`  [${v.status.toUpperCase()}] ${v.memoryKey}: ${v.reason}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
