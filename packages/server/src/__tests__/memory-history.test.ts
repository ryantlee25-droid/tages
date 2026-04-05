import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleMemoryHistory } from '../tools/memory-history'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-history-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(cache: SqliteCache, key: string, value: string, confidence = 1.0) {
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key,
    value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('memory history', () => {
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

  it('returns empty history for a new memory', async () => {
    makeMemory(cache, 'fresh-key', 'initial value')
    const result = await handleMemoryHistory({ key: 'fresh-key' }, TEST_PROJECT, cache, null)
    expect(result.content[0].text).toContain('No version history')
  })

  it('returns not found for unknown key', async () => {
    const result = await handleMemoryHistory({ key: 'unknown-key' }, TEST_PROJECT, cache, null)
    expect(result.content[0].text).toContain('No memory found')
  })

  it('version is created after addVersion', () => {
    makeMemory(cache, 'versioned-key', 'v1 value', 0.9)
    cache.addVersion(TEST_PROJECT, 'versioned-key', 'v1 value', 0.9, 'agent-x', 'update')
    const versions = cache.getVersions(TEST_PROJECT, 'versioned-key')
    expect(versions.length).toBe(1)
    expect(versions[0].value).toBe('v1 value')
    expect(versions[0].changedBy).toBe('agent-x')
    expect(versions[0].changeReason).toBe('update')
  })

  it('multiple versions are ordered newest first', () => {
    makeMemory(cache, 'multi-key', 'v1')
    cache.addVersion(TEST_PROJECT, 'multi-key', 'v1', 1.0, 'agent', 'update')
    cache.addVersion(TEST_PROJECT, 'multi-key', 'v2', 0.9, 'agent', 'update')
    cache.addVersion(TEST_PROJECT, 'multi-key', 'v3', 0.8, 'agent', 'update')
    const versions = cache.getVersions(TEST_PROJECT, 'multi-key')
    expect(versions.length).toBe(3)
    expect(versions[0].version).toBeGreaterThan(versions[1].version)
    expect(versions[1].version).toBeGreaterThan(versions[2].version)
  })

  it('confidence is tracked per version', () => {
    makeMemory(cache, 'conf-key', 'value', 0.5)
    cache.addVersion(TEST_PROJECT, 'conf-key', 'value', 0.5, 'bot', 'update')
    const versions = cache.getVersions(TEST_PROJECT, 'conf-key')
    expect(versions[0].confidence).toBeCloseTo(0.5)
  })

  it('handleMemoryHistory shows version list when versions exist', async () => {
    makeMemory(cache, 'show-key', 'current value')
    cache.addVersion(TEST_PROJECT, 'show-key', 'old value', 0.7, 'agent', 'update')
    const result = await handleMemoryHistory({ key: 'show-key' }, TEST_PROJECT, cache, null)
    expect(result.content[0].text).toContain('Version History')
    expect(result.content[0].text).toContain('old value')
  })

  it('revert restores old version value', async () => {
    makeMemory(cache, 'revert-key', 'current value')
    cache.addVersion(TEST_PROJECT, 'revert-key', 'old value', 0.8, 'agent', 'update')
    const versions = cache.getVersions(TEST_PROJECT, 'revert-key')
    const result = await handleMemoryHistory(
      { key: 'revert-key', revertToVersion: versions[0].version },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Reverted')
    const restored = cache.getByKey(TEST_PROJECT, 'revert-key')
    expect(restored?.value).toBe('old value')
  })

  it('revert to non-existent version returns error', async () => {
    makeMemory(cache, 'nope-key', 'value')
    const result = await handleMemoryHistory(
      { key: 'nope-key', revertToVersion: 999 },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('not found')
  })
})
