import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectDuplicates } from '../dedup/similarity-detector'
import { applyConsolidation } from '../dedup/consolidator'
import type { Memory } from '@tages/shared'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { SqliteCache } from '../cache/sqlite'

const TEST_PROJECT = 'dedup-test-project'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
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

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-dedup-test-${Date.now()}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

describe('detectDuplicates', () => {
  it('detects exact key+value match as duplicate', () => {
    const a = makeMemory({ key: 'auth-pattern', value: 'always use JWT tokens for authentication' })
    const b = makeMemory({ key: 'auth-pattern-2', value: 'always use JWT tokens for authentication in API' })
    const pairs = detectDuplicates([a, b], 0.5)
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs[0].score).toBeGreaterThan(0.5)
  })

  it('detects near-match with different wording', () => {
    const a = makeMemory({ key: 'snake-case', value: 'use snake_case for all database column names' })
    const b = makeMemory({ key: 'db-columns', value: 'database column names should use snake_case format' })
    const pairs = detectDuplicates([a, b], 0.4)
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs[0].score).toBeGreaterThan(0.4)
  })

  it('does not match different types even with similar text', () => {
    const a = makeMemory({ type: 'convention', key: 'use-async', value: 'always use async await for promises' })
    const b = makeMemory({ type: 'decision', key: 'decided-async', value: 'always use async await for promises' })
    const pairs = detectDuplicates([a, b], 0.7)
    // Different types should not be matched
    expect(pairs.length).toBe(0)
  })

  it('returns pairs sorted by score descending', () => {
    const memories = [
      makeMemory({ key: 'a', value: 'use typescript strict mode for better type safety' }),
      makeMemory({ key: 'b', value: 'typescript strict mode provides better type safety' }),
      makeMemory({ key: 'c', value: 'always use snake_case' }),
      makeMemory({ key: 'd', value: 'snake_case is required always' }),
    ]
    const pairs = detectDuplicates(memories, 0.3)
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].score).toBeGreaterThanOrEqual(pairs[i].score)
    }
  })

  it('returns empty array for empty input', () => {
    expect(detectDuplicates([], 0.7)).toEqual([])
  })

  it('returns empty array for single memory', () => {
    const m = makeMemory({ key: 'solo', value: 'nothing to compare' })
    expect(detectDuplicates([m], 0.7)).toEqual([])
  })

  it('ignores non-live memories', () => {
    const a = makeMemory({ key: 'live-one', value: 'live memory for testing purposes', status: 'live' })
    const b = makeMemory({ key: 'pending-one', value: 'live memory for testing purposes', status: 'pending' })
    const pairs = detectDuplicates([a, b], 0.5)
    expect(pairs.length).toBe(0)
  })

  it('suggestedMergedValue picks more detailed version', () => {
    const short = makeMemory({ key: 'a', value: 'use snake_case' })
    const long = makeMemory({ key: 'b', value: 'use snake_case for all database column names and API parameters' })
    const pairs = detectDuplicates([short, long], 0.3)
    if (pairs.length > 0) {
      expect(pairs[0].suggestedMergedValue).toBe(long.value)
    }
  })
})

describe('applyConsolidation', () => {
  it('produces merged memory with survivor key', () => {
    const survivor = makeMemory({ key: 'survivor-key', value: 'short value' })
    const victim = makeMemory({ key: 'victim-key', value: 'longer and more detailed value here' })
    const result = applyConsolidation(survivor, victim)
    expect(result.surviving.key).toBe('survivor-key')
    expect(result.deletedKey).toBe('victim-key')
  })

  it('keeps more detailed value (longer wins)', () => {
    const a = makeMemory({ key: 'a', value: 'short' })
    const b = makeMemory({ key: 'b', value: 'much longer and more detailed description of the convention' })
    const result = applyConsolidation(a, b)
    expect(result.surviving.value).toBe(b.value)
  })

  it('uses provided mergedValue when given', () => {
    const a = makeMemory({ key: 'a', value: 'value a' })
    const b = makeMemory({ key: 'b', value: 'value b' })
    const result = applyConsolidation(a, b, 'custom merged value')
    expect(result.surviving.value).toBe('custom merged value')
  })

  it('unions conditions from both memories', () => {
    const a = makeMemory({ key: 'a', conditions: ['in production', 'with auth'] })
    const b = makeMemory({ key: 'b', conditions: ['in production', 'when testing'] })
    const result = applyConsolidation(a, b)
    expect(result.surviving.conditions).toContain('in production')
    expect(result.surviving.conditions).toContain('with auth')
    expect(result.surviving.conditions).toContain('when testing')
    // Deduplicates: 'in production' only once
    expect(result.surviving.conditions?.filter(c => c === 'in production').length).toBe(1)
  })

  it('unions phases from both memories', () => {
    const a = makeMemory({ key: 'a', phases: ['planning'] })
    const b = makeMemory({ key: 'b', phases: ['implementation'] })
    const result = applyConsolidation(a, b)
    expect(result.surviving.phases).toContain('planning')
    expect(result.surviving.phases).toContain('implementation')
  })

  it('keeps higher confidence', () => {
    const a = makeMemory({ key: 'a', confidence: 0.6 })
    const b = makeMemory({ key: 'b', confidence: 0.9 })
    const result = applyConsolidation(a, b)
    expect(result.surviving.confidence).toBe(0.9)
  })

  it('redirects crossSystemRefs: removes victim key, adds victim refs to survivor', () => {
    const a = makeMemory({ key: 'a', crossSystemRefs: ['victim-key', 'external-ref'] })
    const b = makeMemory({ key: 'victim-key', crossSystemRefs: ['other-ref'] })
    const result = applyConsolidation(a, b)
    // Should not contain victim key reference anymore
    expect(result.surviving.crossSystemRefs).not.toContain('victim-key')
    // Should contain the external refs
    expect(result.surviving.crossSystemRefs).toContain('external-ref')
    expect(result.surviving.crossSystemRefs).toContain('other-ref')
  })

  it('concats unique examples', () => {
    const a = makeMemory({ key: 'a', examples: [{ input: 'foo', output: 'bar' }] })
    const b = makeMemory({ key: 'b', examples: [{ input: 'baz', output: 'qux' }] })
    const result = applyConsolidation(a, b)
    expect(result.surviving.examples?.length).toBe(2)
  })
})

describe('dedup log in cache', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    const result = createTestCache()
    cache = result.cache
    dbPath = result.dbPath
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('logs dedup consolidation', () => {
    cache.logDedupConsolidation(TEST_PROJECT, 'survivor', 'victim', 'test consolidation note')
    const logs = cache.getDedupLog(TEST_PROJECT)
    expect(logs.length).toBe(1)
    expect(logs[0].survivorKey).toBe('survivor')
    expect(logs[0].victimKey).toBe('victim')
    expect(logs[0].mergeNote).toBe('test consolidation note')
  })

  it('retrieves multiple consolidation logs', () => {
    cache.logDedupConsolidation(TEST_PROJECT, 'a', 'b', 'first')
    cache.logDedupConsolidation(TEST_PROJECT, 'c', 'd', 'second')
    const logs = cache.getDedupLog(TEST_PROJECT)
    expect(logs.length).toBe(2)
  })
})
