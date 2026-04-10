import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-id'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-test-${Date.now()}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(overrides: Partial<Parameters<SqliteCache['upsertMemory']>[0]> = {}) {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key: 'test-key',
    value: 'test-value',
    type: 'convention' as const,
    source: 'manual' as const,
    status: 'live' as const,
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('SqliteCache', () => {
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

  describe('upsertMemory', () => {
    it('inserts a new memory', () => {
      const mem = makeMemory({ key: 'new-key', value: 'new-value' })
      cache.upsertMemory(mem)
      const result = cache.getByKey(TEST_PROJECT, 'new-key')
      expect(result).not.toBeNull()
      expect(result!.value).toBe('new-value')
    })

    it('updates an existing memory by project+key', () => {
      const mem1 = makeMemory({ key: 'update-key', value: 'original' })
      cache.upsertMemory(mem1)
      const mem2 = makeMemory({ key: 'update-key', value: 'updated' })
      cache.upsertMemory(mem2)
      const result = cache.getByKey(TEST_PROJECT, 'update-key')
      expect(result!.value).toBe('updated')
    })

    it('marks memories as dirty by default', () => {
      cache.upsertMemory(makeMemory({ key: 'dirty-test' }))
      const dirty = cache.getDirty()
      expect(dirty.length).toBeGreaterThan(0)
      expect(dirty.some(m => m.key === 'dirty-test')).toBe(true)
    })

    it('can insert as clean (not dirty)', () => {
      cache.upsertMemory(makeMemory({ key: 'clean-test' }), false)
      const dirty = cache.getDirty()
      expect(dirty.some(m => m.key === 'clean-test')).toBe(false)
    })

    it('preserves the existing row id on conflict (no FK violation)', () => {
      // Insert original memory and record its id
      const original = makeMemory({ key: 'stable-id-key', value: 'first-value' })
      cache.upsertMemory(original)
      const stored = cache.getByKey(TEST_PROJECT, 'stable-id-key')
      expect(stored).not.toBeNull()
      const originalId = stored!.id

      // Upsert the same project+key with a different id (as if a new UUID was generated)
      const updated = makeMemory({ key: 'stable-id-key', value: 'second-value' })
      // updated.id is a different UUID because makeMemory() calls randomUUID() each time
      expect(updated.id).not.toBe(originalId)
      cache.upsertMemory(updated)

      // The value should be updated but the id must NOT change
      const after = cache.getByKey(TEST_PROJECT, 'stable-id-key')
      expect(after).not.toBeNull()
      expect(after!.value).toBe('second-value')
      expect(after!.id).toBe(originalId)
    })
  })

  describe('queryMemories', () => {
    it('finds memories by LIKE match on key', () => {
      cache.upsertMemory(makeMemory({ key: 'auth-pattern', value: 'JWT tokens' }))
      cache.upsertMemory(makeMemory({ key: 'db-pattern', value: 'Postgres' }))
      const results = cache.queryMemories(TEST_PROJECT, 'auth')
      expect(results.length).toBe(1)
      expect(results[0].key).toBe('auth-pattern')
    })

    it('finds memories by LIKE match on value', () => {
      cache.upsertMemory(makeMemory({ key: 'some-key', value: 'always use snake_case for API routes' }))
      const results = cache.queryMemories(TEST_PROJECT, 'snake_case')
      expect(results.length).toBe(1)
    })

    it('filters by type', () => {
      cache.upsertMemory(makeMemory({ key: 'conv', type: 'convention' }))
      cache.upsertMemory(makeMemory({ key: 'dec', type: 'decision' }))
      const results = cache.queryMemories(TEST_PROJECT, 'conv', 'convention')
      expect(results.length).toBe(1)
      expect(results[0].type).toBe('convention')
    })

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        cache.upsertMemory(makeMemory({ key: `item-${i}`, value: `test value ${i}` }))
      }
      const results = cache.queryMemories(TEST_PROJECT, 'test', undefined, 3)
      expect(results.length).toBe(3)
    })

    it('returns empty array for no matches', () => {
      const results = cache.queryMemories(TEST_PROJECT, 'nonexistent')
      expect(results).toEqual([])
    })
  })

  describe('getByType', () => {
    it('returns all memories of a given type', () => {
      cache.upsertMemory(makeMemory({ key: 'c1', type: 'convention' }))
      cache.upsertMemory(makeMemory({ key: 'c2', type: 'convention' }))
      cache.upsertMemory(makeMemory({ key: 'd1', type: 'decision' }))
      const results = cache.getByType(TEST_PROJECT, 'convention')
      expect(results.length).toBe(2)
    })
  })

  describe('deleteByKey', () => {
    it('deletes a memory and returns true', () => {
      cache.upsertMemory(makeMemory({ key: 'to-delete' }))
      const deleted = cache.deleteByKey(TEST_PROJECT, 'to-delete')
      expect(deleted).toBe(true)
      expect(cache.getByKey(TEST_PROJECT, 'to-delete')).toBeNull()
    })

    it('returns false for non-existent key', () => {
      const deleted = cache.deleteByKey(TEST_PROJECT, 'nonexistent')
      expect(deleted).toBe(false)
    })
  })

  describe('sync operations', () => {
    it('markSynced clears dirty flag', () => {
      const mem = makeMemory({ key: 'sync-test' })
      cache.upsertMemory(mem)
      expect(cache.getDirty().length).toBe(1)
      cache.markSynced([mem.id])
      expect(cache.getDirty().length).toBe(0)
    })

    it('hydrateFromRemote inserts as clean', () => {
      const mems = [
        makeMemory({ key: 'remote-1' }),
        makeMemory({ key: 'remote-2' }),
      ]
      cache.hydrateFromRemote(mems)
      expect(cache.getAllForProject(TEST_PROJECT).length).toBe(2)
      expect(cache.getDirty().length).toBe(0)
    })
  })

  describe('sync metadata', () => {
    it('tracks last synced timestamp', () => {
      expect(cache.getLastSyncedAt(TEST_PROJECT)).toBeNull()
      const ts = new Date().toISOString()
      cache.setLastSyncedAt(TEST_PROJECT, ts, 5)
      expect(cache.getLastSyncedAt(TEST_PROJECT)).toBe(ts)
    })

    it('tracks memory count', () => {
      cache.upsertMemory(makeMemory({ key: 'a' }))
      cache.upsertMemory(makeMemory({ key: 'b' }))
      expect(cache.getMemoryCount(TEST_PROJECT)).toBe(2)
    })
  })

  describe('semanticQuery', () => {
    it('finds memories by cosine similarity', () => {
      const mem = makeMemory({ key: 'semantic-test', value: 'test semantic search' })
      cache.upsertMemoryWithEmbedding(mem, [1, 0, 0, 0])
      const results = cache.semanticQuery(TEST_PROJECT, [1, 0, 0, 0], undefined, 5)
      expect(results.length).toBe(1)
      expect(results[0].key).toBe('semantic-test')
    })

    it('filters out low similarity', () => {
      const mem = makeMemory({ key: 'far-away', value: 'unrelated' })
      cache.upsertMemoryWithEmbedding(mem, [1, 0, 0, 0])
      // Orthogonal vector should have ~0 similarity
      const results = cache.semanticQuery(TEST_PROJECT, [0, 1, 0, 0], undefined, 5)
      expect(results.length).toBe(0)
    })
  })

  describe('getByFilePath', () => {
    it('finds memories referencing a file path', () => {
      cache.upsertMemory(makeMemory({
        key: 'file-test',
        filePaths: ['lib/auth.ts', 'lib/session.ts'],
      }))
      const results = cache.getByFilePath(TEST_PROJECT, 'lib/auth.ts')
      expect(results.length).toBe(1)
    })
  })

  describe('getAccessCounts', () => {
    it('returns empty map for project with no memories', () => {
      const counts = cache.getAccessCounts('nonexistent-project')
      expect(counts.size).toBe(0)
    })

    it('returns correct access counts keyed by memory id', () => {
      const mem1 = makeMemory({ key: 'access-key-1', value: 'v1' })
      const mem2 = makeMemory({ key: 'access-key-2', value: 'v2' })
      cache.upsertMemory(mem1)
      cache.upsertMemory(mem2)

      // mem1 accessed twice, mem2 accessed once
      cache.updateAccessTime(mem1.id)
      cache.updateAccessTime(mem1.id)
      cache.updateAccessTime(mem2.id)

      const counts = cache.getAccessCounts(TEST_PROJECT)
      expect(counts.get(mem1.id)).toBe(2)
      expect(counts.get(mem2.id)).toBe(1)
    })

    it('does not include memories from a different project', () => {
      const OTHER_PROJECT = 'other-project-id'
      const mem1 = makeMemory({ key: 'my-key', value: 'mine' })
      const mem2 = makeMemory({ key: 'other-key', value: 'theirs', projectId: OTHER_PROJECT })
      cache.upsertMemory(mem1)
      cache.upsertMemory(mem2)
      cache.updateAccessTime(mem2.id)

      const counts = cache.getAccessCounts(TEST_PROJECT)
      expect(counts.has(mem2.id)).toBe(false)
      expect(counts.has(mem1.id)).toBe(true)
    })
  })
})
