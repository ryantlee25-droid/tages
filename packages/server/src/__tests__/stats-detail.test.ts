import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { computeStatsDetail, handleStatsDetail } from '../tools/stats-detail'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-stats-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-stats-test-${Date.now()}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(
  cache: SqliteCache,
  overrides: Partial<{
    key: string
    type: 'convention' | 'decision' | 'architecture' | 'entity' | 'lesson' | 'preference' | 'pattern' | 'execution'
    status: 'live' | 'pending'
    confidence: number
    agentName: string
  }> = {},
) {
  const key = overrides.key ?? `key-${Math.random().toString(36).slice(2)}`
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key,
    value: 'test value',
    type: overrides.type ?? 'convention',
    source: 'manual',
    status: overrides.status ?? 'live',
    confidence: overrides.confidence ?? 1.0,
    agentName: overrides.agentName,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('computeStatsDetail', () => {
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

  it('returns zeros for an empty project', () => {
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.total).toBe(0)
    expect(stats.avgConfidence).toBe(0)
    expect(stats.topAgents).toHaveLength(0)
    expect(stats.byType).toEqual({})
    expect(stats.byStatus).toEqual({})
  })

  it('counts total memories', () => {
    makeMemory(cache)
    makeMemory(cache)
    makeMemory(cache)
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.total).toBe(3)
  })

  it('counts by type', () => {
    makeMemory(cache, { type: 'convention' })
    makeMemory(cache, { type: 'convention' })
    makeMemory(cache, { type: 'decision' })
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.byType['convention']).toBe(2)
    expect(stats.byType['decision']).toBe(1)
  })

  it('counts by status', () => {
    makeMemory(cache, { status: 'live' })
    makeMemory(cache, { status: 'live' })
    makeMemory(cache, { status: 'pending' })
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.byStatus['live']).toBe(2)
    expect(stats.byStatus['pending']).toBe(1)
  })

  it('computes average confidence', () => {
    makeMemory(cache, { confidence: 0.5 })
    makeMemory(cache, { confidence: 1.0 })
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.avgConfidence).toBeCloseTo(0.75)
  })

  it('returns top 5 agents sorted by count', () => {
    makeMemory(cache, { agentName: 'agent-a' })
    makeMemory(cache, { agentName: 'agent-a' })
    makeMemory(cache, { agentName: 'agent-a' })
    makeMemory(cache, { agentName: 'agent-b' })
    makeMemory(cache, { agentName: 'agent-b' })
    makeMemory(cache, { agentName: 'agent-c' })
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.topAgents[0]).toEqual({ name: 'agent-a', count: 3 })
    expect(stats.topAgents[1]).toEqual({ name: 'agent-b', count: 2 })
    expect(stats.topAgents[2]).toEqual({ name: 'agent-c', count: 1 })
    expect(stats.topAgents.length).toBeLessThanOrEqual(5)
  })

  it('caps top agents at 5', () => {
    for (let i = 0; i < 8; i++) {
      makeMemory(cache, { agentName: `agent-${i}` })
    }
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.topAgents.length).toBe(5)
  })

  it('ignores memories from other projects', () => {
    cache.upsertMemory({
      id: 'other-id',
      projectId: 'other-project',
      key: 'other-key',
      value: 'other value',
      type: 'convention',
      source: 'manual',
      status: 'live',
      confidence: 1.0,
      filePaths: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    makeMemory(cache)
    const stats = computeStatsDetail(TEST_PROJECT, cache)
    expect(stats.total).toBe(1)
  })
})

describe('handleStatsDetail', () => {
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

  it('returns a text content block', async () => {
    makeMemory(cache, { type: 'convention', status: 'live', agentName: 'bot' })
    const result = await handleStatsDetail(TEST_PROJECT, cache)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('Total: 1')
    expect(result.content[0].text).toContain('convention')
    expect(result.content[0].text).toContain('live')
    expect(result.content[0].text).toContain('bot')
  })

  it('shows average confidence in text output', async () => {
    makeMemory(cache, { confidence: 0.8 })
    const result = await handleStatsDetail(TEST_PROJECT, cache)
    expect(result.content[0].text).toContain('80.0%')
  })
})
