import { describe, it, expect, beforeEach } from 'vitest'
import { checkAgainstConventions } from '../enforcement/convention-checker'
import { ViolationTracker } from '../enforcement/violation-tracker'
import type { Memory } from '@tages/shared'

const PROJECT = 'enforce-test'

function makeMemory(key: string, value: string, type: Memory['type'] = 'convention', overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value,
    type,
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('checkAgainstConventions', () => {
  it('returns compliant when no conventions exist', () => {
    const candidate = makeMemory('new-mem', 'use async await for all async operations')
    const result = checkAgainstConventions(candidate, [])
    expect(result.status).toBe('compliant')
  })

  it('returns compliant for unrelated conventions', () => {
    const candidate = makeMemory('auth-key', 'always use JWT for authentication')
    const convention = makeMemory('db-conv', 'always use snake_case for database columns')
    const result = checkAgainstConventions(candidate, [convention])
    expect(result.status).toBe('compliant')
  })

  it('detects negation conflict: "always X" vs "never X"', () => {
    const existing = makeMemory('auth-conv', 'always use JWT tokens for authentication')
    const candidate = makeMemory('new-auth', 'never use JWT tokens for authentication prefer sessions instead')
    const result = checkAgainstConventions(candidate, [existing])
    expect(result.status).toBe('violation')
    expect(result.conflictingConvention?.key).toBe('auth-conv')
  })

  it('detects negation conflict: "must" vs "avoid"', () => {
    const existing = makeMemory('snake-conv', 'must use snake_case for all database column names')
    const candidate = makeMemory('camel-conv', 'avoid snake_case for database column names use camelCase instead')
    const result = checkAgainstConventions(candidate, [existing])
    expect(result.status).toBe('violation')
  })

  it('returns warning for high overlap (potential duplicate)', () => {
    const existing = makeMemory('async-conv', 'always use async await for promises in node')
    const candidate = makeMemory('async-conv-2', 'always use async await for all promise handling')
    const result = checkAgainstConventions(candidate, [existing])
    // High overlap should trigger at least a warning
    expect(['warning', 'violation']).toContain(result.status)
  })

  it('does not flag non-convention type memories', () => {
    const existing = makeMemory('a-decision', 'decided to use JWT for authentication', 'decision')
    const candidate = makeMemory('b-conv', 'never use JWT for authentication')
    const result = checkAgainstConventions(candidate, [existing])
    // Only checks convention type
    expect(result.status).toBe('compliant')
  })

  it('skips self-comparison (same id)', () => {
    const mem = makeMemory('same-mem', 'always use typescript strict mode')
    const result = checkAgainstConventions(mem, [mem])
    expect(result.status).toBe('compliant')
  })

  it('no conventions = always compliant', () => {
    const candidate = makeMemory('x', 'never use anything')
    expect(checkAgainstConventions(candidate, []).status).toBe('compliant')
  })
})

describe('ViolationTracker', () => {
  let tracker: ViolationTracker

  beforeEach(() => {
    tracker = new ViolationTracker()
  })

  it('logs a violation', () => {
    tracker.logViolation(PROJECT, 'agent-1', 'mem-key', 'conv-key', 'violation', 'test reason')
    const report = tracker.getReport(PROJECT, ['agent-1'])
    expect(report.totalViolations).toBe(1)
    expect(report.totalWarnings).toBe(0)
  })

  it('logs a warning', () => {
    tracker.logViolation(PROJECT, 'agent-1', 'mem-key', 'conv-key', 'warning', 'test reason')
    const report = tracker.getReport(PROJECT, ['agent-1'])
    expect(report.totalViolations).toBe(0)
    expect(report.totalWarnings).toBe(1)
  })

  it('computes per-agent compliance score', () => {
    tracker.logViolation(PROJECT, 'agent-1', 'k1', 'c1', 'violation', 'r1')
    tracker.logViolation(PROJECT, 'agent-1', 'k2', 'c2', 'violation', 'r2')
    const report = tracker.getReport(PROJECT, ['agent-1'])
    const agentScore = report.agentScores.find(a => a.agentName === 'agent-1')
    expect(agentScore?.violations).toBe(2)
    expect(agentScore?.compliance).toBe(0)
  })

  it('includes recent violations in report', () => {
    tracker.logViolation(PROJECT, 'agent-1', 'mem-a', 'conv-a', 'violation', 'test')
    const report = tracker.getReport(PROJECT, ['agent-1'])
    expect(report.recentViolations.length).toBe(1)
    expect(report.recentViolations[0].memoryKey).toBe('mem-a')
  })

  it('shows 100% compliance for agent with no violations', () => {
    const report = tracker.getReport(PROJECT, ['agent-clean'])
    const score = report.agentScores.find(a => a.agentName === 'agent-clean')
    expect(score?.compliance).toBe(100)
  })

  it('handles empty project (no violations)', () => {
    const report = tracker.getReport(PROJECT, [])
    expect(report.totalViolations).toBe(0)
    expect(report.totalWarnings).toBe(0)
  })
})
