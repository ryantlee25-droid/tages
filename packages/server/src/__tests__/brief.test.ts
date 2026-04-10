import { describe, it, expect, vi } from 'vitest'
import { handleBrief, adaptiveBudget, splitTiers, formatCompactBlock } from '../tools/brief'
import type { Memory } from '@tages/shared'
import type { ScoredMemory } from '../search/memory-scorer'

// ── Helpers ──

function makeMemory(overrides: Partial<Memory> & { key: string; type: Memory['type'] }): Memory {
  return {
    id: overrides.key,
    projectId: 'test-project',
    key: overrides.key,
    value: overrides.value ?? `Value for ${overrides.key}`,
    type: overrides.type,
    source: 'manual',
    status: 'live',
    confidence: overrides.confidence ?? 0.5,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    filePaths: overrides.filePaths,
  }
}

function makeScoredMemory(key: string, type: Memory['type'], score: number): ScoredMemory {
  return {
    memory: makeMemory({ key, type }),
    score,
  }
}

function makeCache(memories: Memory[], accessCounts: Map<string, number> = new Map()) {
  return {
    getAllForProject: vi.fn((_projectId: string) => memories),
    getAccessCounts: vi.fn((_projectId: string) => accessCounts),
  } as unknown as import('../cache/sqlite').SqliteCache
}

const PROJECT_ID = 'test-project'
const NULL_SYNC = null

// ── adaptiveBudget ──

describe('adaptiveBudget', () => {
  it('returns 4000 for 0 memories', () => {
    expect(adaptiveBudget(0)).toBe(4000)
  })

  it('returns 4000 for 49 memories', () => {
    expect(adaptiveBudget(49)).toBe(4000)
  })

  it('returns 6000 for 50 memories', () => {
    expect(adaptiveBudget(50)).toBe(6000)
  })

  it('returns 6000 for 199 memories', () => {
    expect(adaptiveBudget(199)).toBe(6000)
  })

  it('returns 8000 for 200 memories', () => {
    expect(adaptiveBudget(200)).toBe(8000)
  })
})

// ── splitTiers ──

describe('splitTiers', () => {
  it('3 items → top=3, compact=0 (min 3)', () => {
    const items = [
      makeScoredMemory('a', 'lesson', 0.9),
      makeScoredMemory('b', 'lesson', 0.8),
      makeScoredMemory('c', 'lesson', 0.7),
    ]
    const { top, compact } = splitTiers(items)
    expect(top).toHaveLength(3)
    expect(compact).toHaveLength(0)
  })

  it('5 items → top=3, compact=2 (20% of 5 = 1, min 3 applies)', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeScoredMemory(`key-${i}`, 'lesson', 1 - i * 0.1),
    )
    const { top, compact } = splitTiers(items)
    expect(top).toHaveLength(3)
    expect(compact).toHaveLength(2)
  })

  it('10 items → top=3, compact=7 (20% of 10 = 2, min 3 applies)', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeScoredMemory(`key-${i}`, 'lesson', 1 - i * 0.05),
    )
    const { top, compact } = splitTiers(items)
    expect(top).toHaveLength(3)
    expect(compact).toHaveLength(7)
  })

  it('20 items → top=4, compact=16 (20% of 20 = 4)', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeScoredMemory(`key-${i}`, 'lesson', 1 - i * 0.02),
    )
    const { top, compact } = splitTiers(items)
    expect(top).toHaveLength(4)
    expect(compact).toHaveLength(16)
  })

  it('extracts .memory from ScoredMemory for top and compact', () => {
    const items = [
      makeScoredMemory('x', 'lesson', 0.9),
      makeScoredMemory('y', 'lesson', 0.5),
      makeScoredMemory('z', 'lesson', 0.3),
      makeScoredMemory('w', 'lesson', 0.1),
    ]
    const { top, compact } = splitTiers(items)
    // top should be Memory objects (have .key, no .score)
    expect(top[0]).toHaveProperty('key', 'x')
    expect(top[0]).not.toHaveProperty('score')
    expect(compact[0]).toHaveProperty('key', 'w')
  })
})

// ── formatCompactBlock ──

describe('formatCompactBlock', () => {
  it('returns empty string for empty array', () => {
    expect(formatCompactBlock([])).toBe('')
  })

  it('produces key: value one-liners', () => {
    const memories = [makeMemory({ key: 'myKey', type: 'lesson', value: 'short value' })]
    const result = formatCompactBlock(memories)
    expect(result).toContain('myKey: short value')
  })

  it('truncates values longer than 120 chars with ...', () => {
    const longValue = 'x'.repeat(150)
    const memories = [makeMemory({ key: 'k', type: 'lesson', value: longValue })]
    const result = formatCompactBlock(memories)
    expect(result).toContain('k: ' + 'x'.repeat(120) + '...')
    expect(result).not.toContain('x'.repeat(150))
  })

  it('does not truncate values exactly 120 chars', () => {
    const value120 = 'a'.repeat(120)
    const memories = [makeMemory({ key: 'k', type: 'lesson', value: value120 })]
    const result = formatCompactBlock(memories)
    expect(result).toContain('k: ' + value120)
    expect(result).not.toContain('...')
  })

  it('includes newline-separated lines for multiple memories', () => {
    const memories = [
      makeMemory({ key: 'k1', type: 'lesson', value: 'v1' }),
      makeMemory({ key: 'k2', type: 'lesson', value: 'v2' }),
    ]
    const result = formatCompactBlock(memories)
    expect(result).toContain('k1: v1')
    expect(result).toContain('k2: v2')
    const lines = result.trim().split('\n')
    expect(lines).toHaveLength(2)
  })
})

// ── Full brief output ordering ──

describe('handleBrief — score ordering', () => {
  it('lists memories in composite score order within a section', async () => {
    const now = new Date()
    const dayMs = 1000 * 60 * 60 * 24

    // Create 5 convention memories with different update times to vary recency
    // High recency = updated recently = higher score
    const memories: Memory[] = [
      makeMemory({
        key: 'old-low',
        type: 'convention',
        confidence: 0.3,
        updatedAt: new Date(now.getTime() - 80 * dayMs).toISOString(),
      }),
      makeMemory({
        key: 'recent-high',
        type: 'convention',
        confidence: 0.9,
        updatedAt: now.toISOString(),
      }),
      makeMemory({
        key: 'medium-mid',
        type: 'convention',
        confidence: 0.6,
        updatedAt: new Date(now.getTime() - 30 * dayMs).toISOString(),
      }),
      makeMemory({
        key: 'very-old-low',
        type: 'convention',
        confidence: 0.2,
        updatedAt: new Date(now.getTime() - 85 * dayMs).toISOString(),
      }),
      makeMemory({
        key: 'new-medium',
        type: 'convention',
        confidence: 0.5,
        updatedAt: new Date(now.getTime() - 5 * dayMs).toISOString(),
      }),
    ]

    // Give 'recent-high' the most accesses to boost its score further
    const accessCounts = new Map<string, number>([
      ['recent-high', 10],
      ['medium-mid', 3],
    ])

    const cache = makeCache(memories, accessCounts)
    const result = await handleBrief({ task: undefined, budget: 10000 }, PROJECT_ID, cache, NULL_SYNC)
    const text = result.content[0].text

    // recent-high should appear before old-low in the output
    const recentPos = text.indexOf('recent-high')
    const oldPos = text.indexOf('old-low')
    expect(recentPos).toBeGreaterThan(-1)
    expect(oldPos).toBeGreaterThan(-1)
    expect(recentPos).toBeLessThan(oldPos)
  })
})

// ── Empty project ──

describe('handleBrief — empty project', () => {
  it('returns "No memories stored" message', async () => {
    const cache = makeCache([])
    const result = await handleBrief({}, PROJECT_ID, cache, NULL_SYNC)
    expect(result.content[0].text).toContain('No memories stored')
  })
})

// ── Adaptive budget integration ──

describe('handleBrief — adaptive budget', () => {
  it('uses adaptiveBudget when no budget arg provided', async () => {
    // With fewer than 50 memories, budget should be 4000 (enough for output)
    const memories = [makeMemory({ key: 'k1', type: 'lesson', value: 'v1' })]
    const cache = makeCache(memories)
    const result = await handleBrief({}, PROJECT_ID, cache, NULL_SYNC)
    // Should succeed and include the memory
    expect(result.content[0].text).toContain('k1')
  })
})
