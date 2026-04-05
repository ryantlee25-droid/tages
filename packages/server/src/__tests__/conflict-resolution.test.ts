import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleResolveConflict, handleListConflicts } from '../tools/resolve-conflict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-conflict-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-conflict-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(cache: SqliteCache, key: string, value: string) {
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key,
    value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date(Date.now() - 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1000).toISOString(),
  })
}

describe('conflict resolution', () => {
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

  it('addConflict records a new conflict', () => {
    makeMemory(cache, 'key-a', 'value a')
    makeMemory(cache, 'key-b', 'value b')
    const id = cache.addConflict(TEST_PROJECT, 'key-a', 'key-b', 'overlapping keys')
    expect(id).toBeTruthy()
    const conflict = cache.getConflict(id)
    expect(conflict).not.toBeNull()
    expect(conflict!.resolved).toBe(false)
    expect(conflict!.reason).toBe('overlapping keys')
  })

  it('listConflicts shows unresolved conflicts', async () => {
    makeMemory(cache, 'ca', 'val a')
    makeMemory(cache, 'cb', 'val b')
    cache.addConflict(TEST_PROJECT, 'ca', 'cb', 'test reason')
    const result = await handleListConflicts(TEST_PROJECT, cache)
    expect(result.content[0].text).toContain('Unresolved Conflicts')
    expect(result.content[0].text).toContain('ca')
    expect(result.content[0].text).toContain('cb')
  })

  it('listConflicts returns no-conflicts message when empty', async () => {
    const result = await handleListConflicts(TEST_PROJECT, cache)
    expect(result.content[0].text).toContain('No unresolved conflicts')
  })

  it('resolves conflict with keep_newer', async () => {
    makeMemory(cache, 'newer-a', 'value a')
    // Make b slightly newer by updating it
    makeMemory(cache, 'newer-b', 'value b')
    cache.upsertMemory({
      ...cache.getByKey(TEST_PROJECT, 'newer-b')!,
      updatedAt: new Date(Date.now() + 5000).toISOString(),
    })
    const id = cache.addConflict(TEST_PROJECT, 'newer-a', 'newer-b', 'overlapping')
    const result = await handleResolveConflict(
      { conflictId: id, strategy: 'keep_newer' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Conflict Resolved')
    const conflict = cache.getConflict(id)
    expect(conflict!.resolved).toBe(true)
  })

  it('resolves conflict with keep_older', async () => {
    makeMemory(cache, 'older-a', 'value a')
    makeMemory(cache, 'older-b', 'value b')
    const id = cache.addConflict(TEST_PROJECT, 'older-a', 'older-b', 'overlapping')
    const result = await handleResolveConflict(
      { conflictId: id, strategy: 'keep_older' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Conflict Resolved')
  })

  it('resolves conflict with merge strategy', async () => {
    makeMemory(cache, 'merge-a', 'part A')
    makeMemory(cache, 'merge-b', 'part B')
    const id = cache.addConflict(TEST_PROJECT, 'merge-a', 'merge-b', 'overlapping')
    const result = await handleResolveConflict(
      { conflictId: id, strategy: 'merge', mergedValue: 'part A and part B combined' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Conflict Resolved')
    expect(result.content[0].text).toContain('merge')
  })

  it('merge without mergedValue returns error', async () => {
    makeMemory(cache, 'err-a', 'value a')
    makeMemory(cache, 'err-b', 'value b')
    const id = cache.addConflict(TEST_PROJECT, 'err-a', 'err-b', 'overlap')
    const result = await handleResolveConflict(
      { conflictId: id, strategy: 'merge' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('mergedValue')
  })

  it('resolving non-existent conflict returns error', async () => {
    const result = await handleResolveConflict(
      { conflictId: 'nonexistent-id', strategy: 'keep_newer' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('not found')
  })
})
