export interface Violation {
  id: string
  projectId: string
  agentName: string
  memoryKey: string
  conventionKey: string
  status: 'violation' | 'warning'
  reason: string
  createdAt: string
}

export interface EnforcementReport {
  projectId: string
  totalViolations: number
  totalWarnings: number
  agentScores: Array<{ agentName: string; compliance: number; violations: number; warnings: number }>
  recentViolations: Violation[]
}

export class ViolationTracker {
  private violations: Map<string, Violation[]> = new Map()

  logViolation(
    projectId: string,
    agentName: string,
    memoryKey: string,
    conventionKey: string,
    status: 'violation' | 'warning',
    reason: string,
  ): Violation {
    const violation: Violation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      projectId,
      agentName,
      memoryKey,
      conventionKey,
      status,
      reason,
      createdAt: new Date().toISOString(),
    }

    if (!this.violations.has(projectId)) {
      this.violations.set(projectId, [])
    }
    this.violations.get(projectId)!.push(violation)
    return violation
  }

  getReport(projectId: string, allAgents: string[]): EnforcementReport {
    const violations = this.violations.get(projectId) || []
    const totalViolations = violations.filter(v => v.status === 'violation').length
    const totalWarnings = violations.filter(v => v.status === 'warning').length

    // Per-agent compliance scores
    const agentMap = new Map<string, { violations: number; warnings: number; total: number }>()
    for (const agent of allAgents) {
      agentMap.set(agent, { violations: 0, warnings: 0, total: 0 })
    }

    for (const v of violations) {
      if (!agentMap.has(v.agentName)) {
        agentMap.set(v.agentName, { violations: 0, warnings: 0, total: 0 })
      }
      const entry = agentMap.get(v.agentName)!
      entry.total++
      if (v.status === 'violation') entry.violations++
      else entry.warnings++
    }

    const agentScores = [...agentMap.entries()].map(([agentName, stats]) => ({
      agentName,
      compliance: stats.total === 0 ? 100 : Math.round(((stats.total - stats.violations) / stats.total) * 100),
      violations: stats.violations,
      warnings: stats.warnings,
    }))

    return {
      projectId,
      totalViolations,
      totalWarnings,
      agentScores,
      recentViolations: violations.slice(-20).reverse(),
    }
  }
}

// Global singleton for the MCP server lifetime
export const globalViolationTracker = new ViolationTracker()
