import { describe, it, expect } from 'vitest'
import { computeSemanticDrift } from '../semantic-drift.js'
import type { FieldChangeRow } from '../types.js'

function row(
  memory_id: string,
  new_value: unknown,
  overrides: Partial<FieldChangeRow> = {},
): FieldChangeRow {
  return {
    memory_id,
    memory_key: memory_id,
    project_id: 'p',
    field_name: 'value',
    old_value: null,
    new_value,
    change_type: 'modified',
    created_at: '2026-04-20T00:00:00Z',
    session_id: 'sess-a',
    agent_name: 'claude',
    ...overrides,
  }
}

describe('computeSemanticDrift', () => {
  it('returns zero drift on an empty changelog', () => {
    const r = computeSemanticDrift([])
    expect(r.score).toBe(0)
    expect(r.keysExamined).toBe(0)
    expect(r.keysWithDrift).toBe(0)
    expect(r.topKeys).toEqual([])
  })

  it('gives zero instability for a key with a single value across many writes', () => {
    const changes = [
      row('m1', 'use tabs'),
      row('m1', 'use tabs'),
      row('m1', 'use tabs'),
    ]
    const r = computeSemanticDrift(changes)
    expect(r.score).toBe(0)
    expect(r.keysExamined).toBe(1)
    expect(r.keysWithDrift).toBe(0)
    expect(r.topKeys[0]?.distinctValues).toBe(1)
    expect(r.topKeys[0]?.instability).toBe(0)
  })

  it('produces instability 0.5 for two distinct values', () => {
    const r = computeSemanticDrift([row('m1', 'tabs'), row('m1', 'spaces')])
    expect(r.topKeys[0]?.distinctValues).toBe(2)
    expect(r.topKeys[0]?.instability).toBe(0.5)
    expect(r.keysWithDrift).toBe(1)
  })

  it('produces instability 0.67 (2/3) for three distinct values', () => {
    const r = computeSemanticDrift([
      row('m1', 'tabs'),
      row('m1', 'spaces'),
      row('m1', 'mixed'),
    ])
    expect(r.topKeys[0]?.distinctValues).toBe(3)
    expect(r.topKeys[0]?.instability).toBeCloseTo(2 / 3, 4)
  })

  it('surfaces sessions and agents on drift reports', () => {
    const r = computeSemanticDrift([
      row('m1', 'tabs', { session_id: 's1', agent_name: 'claude' }),
      row('m1', 'spaces', { session_id: 's2', agent_name: 'cursor' }),
    ])
    expect(r.topKeys[0]?.sessions.sort()).toEqual(['s1', 's2'])
    expect(r.topKeys[0]?.agents.sort()).toEqual(['claude', 'cursor'])
  })

  it('ignores non-value field changes', () => {
    const r = computeSemanticDrift([
      row('m1', 'first', { field_name: 'tags' }),
      row('m1', 'second', { field_name: 'tags' }),
    ])
    expect(r.keysExamined).toBe(0)
  })

  it('normalizes whitespace so trailing spaces do not count as drift', () => {
    const r = computeSemanticDrift([row('m1', 'use tabs'), row('m1', '  use tabs  ')])
    expect(r.topKeys[0]?.distinctValues).toBe(1)
    expect(r.topKeys[0]?.instability).toBe(0)
  })

  it('sorts topKeys by instability, then by totalChanges as tiebreaker', () => {
    const changes: FieldChangeRow[] = [
      // m1: three distinct values → instability 2/3
      row('m1', 'a'),
      row('m1', 'b'),
      row('m1', 'c'),
      // m2: two distinct values → instability 0.5
      row('m2', 'x'),
      row('m2', 'y'),
    ]
    const r = computeSemanticDrift(changes)
    expect(r.topKeys[0]?.memoryKey).toBe('m1')
    expect(r.topKeys[1]?.memoryKey).toBe('m2')
  })

  it('respects the topK option', () => {
    const changes: FieldChangeRow[] = []
    for (let i = 0; i < 20; i++) {
      changes.push(row(`m${i}`, 'a'))
      changes.push(row(`m${i}`, 'b'))
    }
    const r = computeSemanticDrift(changes, { topK: 5 })
    expect(r.topKeys.length).toBe(5)
    expect(r.keysExamined).toBe(20)
  })

  it('computes overall score as mean instability across keys', () => {
    const changes: FieldChangeRow[] = [
      row('m1', 'a'),
      row('m1', 'b'), // 0.5
      row('m2', 'x'),
      row('m2', 'y'),
      row('m2', 'z'), // 2/3
      row('m3', 'same'),
      row('m3', 'same'), // 0
    ]
    const r = computeSemanticDrift(changes)
    const expected = (0.5 + 2 / 3 + 0) / 3
    expect(r.score).toBeCloseTo(expected, 4)
  })
})
