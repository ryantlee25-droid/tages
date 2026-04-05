import { describe, it, expect } from 'vitest'
import { scoreMemory, computeProjectHealth } from '../quality/memory-scorer'
import { findContradictions, findStaleRefs } from '../quality/consistency-checker'
import type { Memory } from '@tages/shared'

const PROJECT = 'quality-test'

function makeMemory(key: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value: 'test value for quality scoring',
    type: 'convention',
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

describe('scoreMemory — completeness', () => {
  it('scores 0 for empty memory', () => {
    const mem = makeMemory('empty', { conditions: undefined, examples: undefined, crossSystemRefs: undefined, tags: [], filePaths: [] })
    const score = scoreMemory(mem)
    expect(score.completeness).toBe(0)
  })

  it('scores 25 for fully decorated memory', () => {
    const mem = makeMemory('full', {
      conditions: ['when in prod'],
      examples: [{ input: 'x', output: 'y' }],
      crossSystemRefs: ['other-key'],
      tags: ['important'],
      filePaths: ['src/index.ts'],
    })
    const score = scoreMemory(mem)
    expect(score.completeness).toBe(25)
  })

  it('gives partial score for partially decorated memory', () => {
    const mem = makeMemory('partial', {
      conditions: ['when in test'],
      tags: ['test'],
    })
    const score = scoreMemory(mem)
    expect(score.completeness).toBe(10)
  })
})

describe('scoreMemory — freshness', () => {
  it('scores 25 for brand new memory', () => {
    const mem = makeMemory('fresh', { updatedAt: new Date().toISOString() })
    const score = scoreMemory(mem)
    expect(score.freshness).toBe(25)
  })

  it('scores 0 for 180+ day old memory', () => {
    const oldDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString()
    const mem = makeMemory('stale', { updatedAt: oldDate })
    const score = scoreMemory(mem)
    expect(score.freshness).toBe(0)
  })

  it('scores between 0 and 25 for moderately old memory', () => {
    const midDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const mem = makeMemory('mid', { updatedAt: midDate })
    const score = scoreMemory(mem)
    expect(score.freshness).toBeGreaterThan(0)
    expect(score.freshness).toBeLessThan(25)
  })
})

describe('scoreMemory — consistency', () => {
  it('scores 25 when no contradictions', () => {
    const mem = makeMemory('a', { value: 'always use JWT for auth' })
    const other = makeMemory('b', { value: 'use snake_case for columns' })
    const score = scoreMemory(mem, [mem, other])
    expect(score.consistency).toBe(25)
  })

  it('scores 0 when contradiction detected', () => {
    const mem = makeMemory('a', { value: 'always use JWT for authentication' })
    const other = makeMemory('b', { value: 'never use JWT for authentication prefer sessions' })
    const score = scoreMemory(mem, [mem, other])
    expect(score.consistency).toBe(0)
  })
})

describe('scoreMemory — usefulness', () => {
  it('scores higher for high confidence', () => {
    const high = makeMemory('a', { confidence: 1.0, value: 'x'.repeat(50) })
    const low = makeMemory('b', { confidence: 0.1, value: 'x'.repeat(50) })
    expect(scoreMemory(high).usefulness).toBeGreaterThan(scoreMemory(low).usefulness)
  })
})

describe('scoreMemory — total', () => {
  it('perfect memory scores 100', () => {
    const mem = makeMemory('perfect', {
      conditions: ['when in prod'],
      examples: [{ input: 'x', output: 'y' }],
      crossSystemRefs: ['other'],
      tags: ['tag'],
      filePaths: ['src/a.ts'],
      confidence: 1.0,
      value: 'a'.repeat(200),
      updatedAt: new Date().toISOString(),
    })
    const score = scoreMemory(mem, [mem])
    // completeness=25 + freshness=25 + consistency=25 + usefulness=25 = 100
    expect(score.total).toBe(100)
  })

  it('empty old memory scores low', () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    const mem = makeMemory('bad', {
      conditions: undefined, examples: undefined, crossSystemRefs: undefined,
      tags: [], filePaths: [], confidence: 0.1, value: 'x',
      updatedAt: oldDate,
    })
    const score = scoreMemory(mem)
    expect(score.total).toBeLessThan(30)
  })
})

describe('computeProjectHealth', () => {
  it('returns 0 for empty project', () => {
    const health = computeProjectHealth([])
    expect(health.averageScore).toBe(0)
  })

  it('aggregates scores correctly', () => {
    const memories = [
      makeMemory('a', { conditions: ['x'], examples: [{ input: 'i', output: 'o' }], crossSystemRefs: ['b'], tags: ['t'], filePaths: ['f'], confidence: 1.0, value: 'a'.repeat(200) }),
      makeMemory('b', { conditions: undefined, examples: undefined, tags: [], filePaths: [], confidence: 0.3, value: 'x' }),
    ]
    const health = computeProjectHealth(memories)
    expect(health.averageScore).toBeGreaterThan(0)
    expect(health.averageScore).toBeLessThan(100)
  })

  it('provides suggestions when memories lack examples', () => {
    const memories = Array.from({ length: 5 }, (_, i) =>
      makeMemory(`key-${i}`, { examples: undefined })
    )
    const health = computeProjectHealth(memories)
    expect(health.suggestions.some(s => s.includes('examples'))).toBe(true)
  })

  it('identifies worst memories', () => {
    const memories = [
      makeMemory('good', { conditions: ['x'], examples: [{ input: 'i', output: 'o' }], crossSystemRefs: ['b'], tags: ['t'], filePaths: ['f'], confidence: 1.0, value: 'a'.repeat(200) }),
      makeMemory('bad', { confidence: 0.1, value: 'x', tags: [], filePaths: [] }),
    ]
    const health = computeProjectHealth(memories)
    expect(health.worstMemories[0].key).toBe('bad')
  })
})

describe('findContradictions', () => {
  it('finds "always" vs "never" contradiction', () => {
    const a = makeMemory('a', { value: 'always use JWT for authentication in APIs', type: 'convention' })
    const b = makeMemory('b', { value: 'never use JWT for authentication prefer sessions', type: 'convention' })
    const contradictions = findContradictions([a, b])
    expect(contradictions.length).toBeGreaterThan(0)
  })

  it('does not flag unrelated memories', () => {
    const a = makeMemory('a', { value: 'always use snake_case for db columns' })
    const b = makeMemory('b', { value: 'use TypeScript strict mode' })
    expect(findContradictions([a, b]).length).toBe(0)
  })

  it('does not compare different types', () => {
    const a = makeMemory('a', { value: 'always use snake_case', type: 'convention' })
    const b = makeMemory('b', { value: 'never use snake_case', type: 'decision' })
    const contradictions = findContradictions([a, b])
    expect(contradictions.length).toBe(0)
  })
})

describe('findStaleRefs', () => {
  it('finds refs to non-existent memories', () => {
    const a = makeMemory('a', { crossSystemRefs: ['deleted-key'] })
    const stale = findStaleRefs([a], [a])
    expect(stale.length).toBe(1)
    expect(stale[0].staleRef).toBe('deleted-key')
  })

  it('does not flag valid refs', () => {
    const a = makeMemory('a', { crossSystemRefs: ['b'] })
    const b = makeMemory('b', {})
    const stale = findStaleRefs([a], [a, b])
    expect(stale.length).toBe(0)
  })

  it('flags refs to archived memories', () => {
    const a = makeMemory('a', { crossSystemRefs: ['archived-b'] })
    const b = makeMemory('archived-b', { status: 'pending' })
    // pending is not live
    const stale = findStaleRefs([a], [a, b])
    expect(stale.length).toBe(1)
  })
})
