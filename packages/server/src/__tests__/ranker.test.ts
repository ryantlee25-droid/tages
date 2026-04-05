import { describe, it, expect } from 'vitest'
import { combineScores, rankResults, asTextResults, asSemanticResults } from '../search/ranker'
import type { Memory } from '@tages/shared'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    projectId: 'proj-1',
    key: 'test-key',
    value: 'test value',
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

describe('combineScores', () => {
  it('combines semantic and text scores with default weights', () => {
    const mem = makeMemory({ confidence: 1.0 })
    const score = combineScores(0.8, 0.6, mem)
    // blended = 0.8*0.6 + 0.6*0.4 = 0.48 + 0.24 = 0.72
    // confidenceAdj = 1 + (1.0 - 0.5) * 0.3 = 1.15
    // recency boost applies (new memory) = 1.15
    // final = 0.72 * 1.15 * 1.15 ≈ 0.952
    expect(score).toBeGreaterThan(0.7)
    expect(score).toBeGreaterThan(0)
  })

  it('semantic-only result scores correctly', () => {
    const mem = makeMemory({ confidence: 1.0 })
    const score = combineScores(0.9, 0, mem)
    // blended = 0.9*0.6 = 0.54
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1.5)
  })

  it('text-only result scores correctly', () => {
    const mem = makeMemory({ confidence: 1.0 })
    const score = combineScores(0, 1.0, mem)
    // blended = 1.0*0.4 = 0.40
    expect(score).toBeGreaterThan(0)
  })

  it('confidence weighting: high confidence scores higher', () => {
    const highConf = makeMemory({ confidence: 1.0 })
    const lowConf = makeMemory({ confidence: 0.3 })
    const highScore = combineScores(0.7, 0.5, highConf)
    const lowScore = combineScores(0.7, 0.5, lowConf)
    expect(highScore).toBeGreaterThan(lowScore)
  })

  it('recency boost: recently updated scores higher than old memory', () => {
    const fresh = makeMemory({ updatedAt: new Date().toISOString() })
    const old = makeMemory({ updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() })
    const freshScore = combineScores(0.7, 0.5, fresh)
    const oldScore = combineScores(0.7, 0.5, old)
    expect(freshScore).toBeGreaterThan(oldScore)
  })

  it('zero scores for both inputs gives zero blended score', () => {
    const mem = makeMemory({ confidence: 0.5 })
    const score = combineScores(0, 0, mem)
    expect(score).toBe(0)
  })
})

describe('rankResults', () => {
  it('returns empty array for empty input', () => {
    expect(rankResults([])).toEqual([])
  })

  it('returns single result unchanged', () => {
    const mem = makeMemory({ key: 'only-one' })
    const results = rankResults([{ memory: mem, semanticScore: 0.8, textScore: 0.6 }])
    expect(results.length).toBe(1)
    expect(results[0].key).toBe('only-one')
  })

  it('ranks higher scoring results first', () => {
    const high = makeMemory({ key: 'high', confidence: 1.0 })
    const low = makeMemory({ key: 'low', confidence: 0.3 })
    const results = rankResults([
      { memory: low, semanticScore: 0.3, textScore: 0.2 },
      { memory: high, semanticScore: 0.9, textScore: 0.8 },
    ])
    expect(results[0].key).toBe('high')
    expect(results[1].key).toBe('low')
  })

  it('deduplicates by id (keeps highest-scored occurrence)', () => {
    const mem = makeMemory({ key: 'dup' })
    const results = rankResults([
      { memory: mem, semanticScore: 0.9, textScore: 0 },
      { memory: mem, semanticScore: 0, textScore: 0.8 },
    ])
    expect(results.length).toBe(1)
    expect(results[0].key).toBe('dup')
  })

  it('tie-breaking: newer updatedAt wins', () => {
    const older = makeMemory({
      key: 'older',
      id: 'aaa',
      updatedAt: new Date(Date.now() - 1000).toISOString(),
    })
    const newer = makeMemory({
      key: 'newer',
      id: 'bbb',
      updatedAt: new Date().toISOString(),
    })
    const results = rankResults([
      { memory: older, semanticScore: 0.5, textScore: 0.5 },
      { memory: newer, semanticScore: 0.5, textScore: 0.5 },
    ])
    // Both have same blended score but newer has recency boost
    expect(results[0].key).toBe('newer')
  })

  it('asTextResults wraps memories with textScore=1, semanticScore=0', () => {
    const mems = [makeMemory({ key: 'a' }), makeMemory({ key: 'b' })]
    const scored = asTextResults(mems)
    expect(scored.length).toBe(2)
    expect(scored[0].textScore).toBe(1)
    expect(scored[0].semanticScore).toBe(0)
  })

  it('asSemanticResults wraps memories with given scores', () => {
    const mems = [makeMemory(), makeMemory()]
    const scored = asSemanticResults(mems, [0.9, 0.4])
    expect(scored[0].semanticScore).toBe(0.9)
    expect(scored[1].semanticScore).toBe(0.4)
    expect(scored[0].textScore).toBe(0)
  })
})
