import { describe, it, expect } from 'vitest'
import { computeDrift } from '../compute.js'
import type { FieldChangeRow, ToolCallRow } from '../types.js'

function bulk(agent: string, tool: string, n: number, startIso: string): ToolCallRow[] {
  const start = Date.parse(startIso)
  return Array.from({ length: n }, (_, i) => ({
    project_id: 'p',
    session_id: 's',
    agent_name: agent,
    tool_name: tool,
    created_at: new Date(start + i * 3600_000).toISOString(),
  }))
}

describe('computeDrift weight aggregation', () => {
  it('exposes the new {semantic: 0.7, behavioral: 0.3, coordination: 0} weights', () => {
    const r = computeDrift({
      projectId: 'p',
      fieldChanges: [],
      toolCalls: [],
    })
    expect(r.weights.semantic).toBe(0.7)
    expect(r.weights.behavioral).toBeCloseTo(0.3, 10)
    expect(r.weights.coordination).toBe(0)
  })

  it('returns 0 driftScore when both metrics are insufficient_data', () => {
    const r = computeDrift({
      projectId: 'p',
      fieldChanges: [],
      toolCalls: [],
    })
    expect(r.driftScore).toBe(0)
    expect(r.behavioral.status).toBe('insufficient_data')
  })

  it('propagates a healthy behavioral score into the aggregate as expected', () => {
    // Identical-distribution behavioral case → score near 0; with semantic
    // also empty/zero, aggregate should also be near 0.
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'recall', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeDrift({
      projectId: 'p',
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
      fieldChanges: [],
      toolCalls: calls,
    })
    expect(r.behavioral.status).toBe('ok')
    expect(r.driftScore).toBeLessThan(0.05)
  })

  it('propagates a high behavioral score into the aggregate via the 0.3 weight', () => {
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'forget', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeDrift({
      projectId: 'p',
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
      fieldChanges: [],
      toolCalls: calls,
    })
    expect(r.behavioral.status).toBe('ok')
    // behavioral.score * 0.3 / (0.7 + 0 + 0.3) = behavioral.score * 0.3
    const expectedFromBehavioral = r.behavioral.score * 0.3
    expect(r.driftScore).toBeCloseTo(expectedFromBehavioral, 4)
  })

  it('does not crash when fieldChanges contains rows but toolCalls is empty', () => {
    const fc: FieldChangeRow[] = [
      {
        memory_id: 'm1',
        memory_key: 'pref/coverage',
        project_id: 'p',
        field_name: 'value',
        old_value: '80',
        new_value: '90',
        change_type: 'modified',
        created_at: '2026-04-15T00:00:00Z',
        session_id: 's',
        agent_name: 'claude',
      },
    ]
    const r = computeDrift({
      projectId: 'p',
      fieldChanges: fc,
      toolCalls: [],
    })
    expect(r.semantic.keysExamined).toBe(1)
    expect(r.behavioral.status).toBe('insufficient_data')
    expect(Number.isFinite(r.driftScore)).toBe(true)
  })
})
