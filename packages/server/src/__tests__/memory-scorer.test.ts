import { describe, it, expect } from 'vitest'
import type { Memory } from '@tages/shared'
import { scoreMemory, scoreAndSort } from '../search/memory-scorer'

function makeMemory(overrides: Partial<Memory>): Memory {
  return {
    id: 'test-id',
    projectId: 'test-project',
    key: 'test-key',
    value: 'test-value',
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Memory
}

describe('scoreMemory', () => {
  it('scores near 1.0 for confidence=1, updated today, highest access count', () => {
    const memory = makeMemory({ confidence: 1.0, updatedAt: new Date().toISOString() })
    const score = scoreMemory(memory, 10, 10)
    // confidence*0.4 + recency*0.3 + accessFrequency*0.3 = 0.4 + 0.3 + 0.3 = 1.0
    expect(score).toBeCloseTo(1.0, 2)
  })

  it('recency boundary: memory updated 0 days ago → recency = 1.0', () => {
    const memory = makeMemory({ confidence: 0, updatedAt: new Date().toISOString() })
    const score = scoreMemory(memory, 0, 0)
    // confidence*0.4 + recency*0.3 + 0 = 0 + 0.3 = 0.3
    expect(score).toBeCloseTo(0.3, 2)
  })

  it('recency boundary: memory updated 90 days ago → recency = 0.0', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const memory = makeMemory({ confidence: 0, updatedAt: ninetyDaysAgo })
    const score = scoreMemory(memory, 0, 0)
    // confidence*0.4 + recency*0.3 + 0 = 0 + 0 = 0
    expect(score).toBeCloseTo(0, 2)
  })

  it('recency boundary: memory updated 45 days ago → recency ≈ 0.5', () => {
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    const memory = makeMemory({ confidence: 0, updatedAt: fortyFiveDaysAgo })
    const score = scoreMemory(memory, 0, 0)
    // confidence*0.4 + recency*0.3 + 0 = 0 + 0.5*0.3 = 0.15
    expect(score).toBeCloseTo(0.15, 1)
  })

  it('access frequency: maxAccessCount=0 → accessFrequency=0', () => {
    const memory = makeMemory({ confidence: 0, updatedAt: new Date(0).toISOString() })
    const score = scoreMemory(memory, 5, 0)
    // confidence=0, recency≈0 (way in past), accessFrequency=0
    expect(score).toBeCloseTo(0, 1)
  })

  it('access frequency: accessCount=5, max=10 → frequency=0.5', () => {
    const memory = makeMemory({ confidence: 0, updatedAt: new Date(0).toISOString() })
    const score = scoreMemory(memory, 5, 10)
    // confidence*0.4 + recency*0.3 + 0.5*0.3 = 0 + ~0 + 0.15 = 0.15
    expect(score).toBeCloseTo(0.15, 1)
  })
})

describe('scoreAndSort', () => {
  it('returns higher scored memories first', () => {
    const highConf = makeMemory({ id: 'high', confidence: 1.0, updatedAt: new Date().toISOString() })
    const lowConf = makeMemory({ id: 'low', confidence: 0.0, updatedAt: new Date(0).toISOString() })
    const counts = new Map<string, number>([['high', 10], ['low', 0]])
    const result = scoreAndSort([lowConf, highConf], counts)
    expect(result[0].memory.id).toBe('high')
    expect(result[1].memory.id).toBe('low')
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  it('tie-break: same score → more recently updated first', () => {
    const now = new Date().toISOString()
    const older = new Date(Date.now() - 1000).toISOString()
    // Both get same confidence, same access, different updatedAt
    const memA = makeMemory({ id: 'a', confidence: 0.5, updatedAt: now })
    const memB = makeMemory({ id: 'b', confidence: 0.5, updatedAt: older })
    const counts = new Map<string, number>()
    const result = scoreAndSort([memB, memA], counts)
    expect(result[0].memory.id).toBe('a')
    expect(result[1].memory.id).toBe('b')
  })

  it('tie-break: same score and same updatedAt → lexicographic id order', () => {
    const ts = new Date().toISOString()
    const memB = makeMemory({ id: 'b-id', confidence: 0.5, updatedAt: ts })
    const memA = makeMemory({ id: 'a-id', confidence: 0.5, updatedAt: ts })
    const counts = new Map<string, number>()
    const result = scoreAndSort([memB, memA], counts)
    expect(result[0].memory.id).toBe('a-id')
    expect(result[1].memory.id).toBe('b-id')
  })

  it('returns empty array for empty input', () => {
    const result = scoreAndSort([], new Map())
    expect(result).toEqual([])
  })

  it('all-zero access counts: still scores correctly using confidence + recency', () => {
    const memory = makeMemory({ id: 'x', confidence: 0.8, updatedAt: new Date().toISOString() })
    const counts = new Map<string, number>()
    const result = scoreAndSort([memory], counts)
    expect(result).toHaveLength(1)
    // score = 0.8*0.4 + 1.0*0.3 + 0*0.3 = 0.32 + 0.30 = 0.62
    expect(result[0].score).toBeCloseTo(0.62, 1)
  })
})
