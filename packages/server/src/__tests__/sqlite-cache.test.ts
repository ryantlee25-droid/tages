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

  describe('upsertMemoryWithEmbedding on an EXISTING key (B1 regression)', () => {
    // Bug: upsertMemory is INSERT ... ON CONFLICT (project_id, key) DO UPDATE,
    // which KEEPS the existing row id. The CLI always builds a fresh randomUUID(),
    // so keying the embedding UPDATE on `WHERE id = ?` matched ZERO rows on a
    // re-remember of an existing key — the embedding was silently dropped and the
    // memory stayed invisible to semantic recall. The UPDATE must key on
    // (project_id, key) instead.
    it('stores the embedding when re-remembering an existing key with a NEW id', () => {
      // First write with id1 (no embedding yet), then re-remember same key with a
      // different id2 + an embedding — as the CLI does on every remember.
      const first = makeMemory({ id: 'id1', key: 'reup', value: 'v1' })
      cache.upsertMemory(first, false)

      const second = makeMemory({ id: 'id2', key: 'reup', value: 'v2' })
      expect(second.id).not.toBe(first.id)
      cache.upsertMemoryWithEmbedding(second, [1, 0, 0, 0], true)

      // Row id is preserved from the original insert...
      const stored = cache.getByKey(TEST_PROJECT, 'reup')
      expect(stored!.id).toBe('id1')
      expect(stored!.value).toBe('v2')

      // ...and the embedding is present despite the id mismatch (visible to search).
      const results = cache.semanticQuery(TEST_PROJECT, [1, 0, 0, 0], undefined, 5)
      expect(results.some((m) => m.key === 'reup')).toBe(true)

      // ...and it reaches the sync payload: getDirty() carries the embedding.
      const dirty = cache.getDirty()
      const dirtyRow = dirty.find((m) => m.key === 'reup')
      expect(dirtyRow).toBeDefined()
      expect(dirtyRow!.embedding).toEqual([1, 0, 0, 0])
    })
  })

  describe('setEmbedding (narrow embedding-only update)', () => {
    it('sets only the embedding, leaving value/dirty untouched', () => {
      const mem = makeMemory({ key: 'narrow', value: 'original value' })
      cache.upsertMemory(mem, false) // dirty = 0 (synced)

      cache.setEmbedding(TEST_PROJECT, 'narrow', [1, 0, 0, 0])

      // Value preserved.
      expect(cache.getByKey(TEST_PROJECT, 'narrow')!.value).toBe('original value')
      // Dirty flag not touched — this memory is not among the dirty set.
      expect(cache.getDirty().some((m) => m.key === 'narrow')).toBe(false)
      // Embedding applied (visible via semanticQuery).
      const results = cache.semanticQuery(TEST_PROJECT, [1, 0, 0, 0], undefined, 5)
      expect(results.some((m) => m.key === 'narrow')).toBe(true)
    })

    it('is a no-op when the row does not exist (does not create it)', () => {
      cache.setEmbedding(TEST_PROJECT, 'does-not-exist', [1, 0, 0, 0])
      expect(cache.getByKey(TEST_PROJECT, 'does-not-exist')).toBeNull()
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

  /**
   * Tests for Task 9 (Phase 2): local `memory_chunks` mirror table.
   */
  describe('upsertChunks / chunk sync helpers', () => {
    function makeChunks(n: number): Array<{ text: string; embedding: number[] }> {
      return Array.from({ length: n }, (_, i) => ({
        text: `chunk ${i}`,
        embedding: new Array(1536).fill(0).map((_, j) => (j === 0 ? i + 1 : 0)),
      }))
    }

    it('inserts chunk rows retrievable via getChunksForMemory, in chunk_index order', () => {
      const mem = makeMemory({ key: 'chunked-key' })
      cache.upsertMemory(mem)

      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(3))

      const chunks = cache.getChunksForMemory(mem.id)
      expect(chunks).toHaveLength(3)
      expect(chunks.map((c) => c.text)).toEqual(['chunk 0', 'chunk 1', 'chunk 2'])
    })

    it('replaces (not appends) chunk rows for the same memory_id on a second call', () => {
      const mem = makeMemory({ key: 'replace-key' })
      cache.upsertMemory(mem)

      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(3))
      expect(cache.getChunksForMemory(mem.id)).toHaveLength(3)

      // Re-chunk with a different count — old rows must be gone, not merged.
      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(2))

      const chunks = cache.getChunksForMemory(mem.id)
      expect(chunks).toHaveLength(2)
      expect(chunks.map((c) => c.text)).toEqual(['chunk 0', 'chunk 1'])
    })

    it('does not affect chunk rows belonging to a different memory', () => {
      const memA = makeMemory({ key: 'key-a' })
      const memB = makeMemory({ key: 'key-b' })
      cache.upsertMemory(memA)
      cache.upsertMemory(memB)

      cache.upsertChunks(memA.id, TEST_PROJECT, makeChunks(2))
      cache.upsertChunks(memB.id, TEST_PROJECT, makeChunks(1))

      cache.upsertChunks(memA.id, TEST_PROJECT, makeChunks(4))

      expect(cache.getChunksForMemory(memA.id)).toHaveLength(4)
      expect(cache.getChunksForMemory(memB.id)).toHaveLength(1)
    })

    it('marks new chunk rows dirty by default, surfaced via getDirtyChunkGroups', () => {
      const mem = makeMemory({ key: 'dirty-key' })
      cache.upsertMemory(mem)
      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(2))

      const groups = cache.getDirtyChunkGroups()
      expect(groups).toContainEqual({ memoryId: mem.id, projectId: TEST_PROJECT })
    })

    it('markChunksSynced clears the dirty flag (by row id) so the memory drops out of getDirtyChunkGroups', () => {
      const mem = makeMemory({ key: 'synced-key' })
      cache.upsertMemory(mem)
      const rowIds = cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(2))

      // Fix C: markChunksSynced now takes the specific chunk row ids.
      cache.markChunksSynced(rowIds)

      const groups = cache.getDirtyChunkGroups()
      expect(groups.find((g) => g.memoryId === mem.id)).toBeUndefined()
    })

    it('upsertChunks returns the inserted row ids, retrievable as dirty via getDirtyChunkRows (Fix C)', () => {
      const mem = makeMemory({ key: 'rowid-key' })
      cache.upsertMemory(mem)
      const rowIds = cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(3))

      expect(rowIds).toHaveLength(3)
      const dirty = cache.getDirtyChunkRows(mem.id)
      expect(dirty.map((r) => r.id).sort()).toEqual([...rowIds].sort())
      expect(dirty.map((r) => r.text)).toEqual(['chunk 0', 'chunk 1', 'chunk 2'])
    })

    it('markChunksSynced by OLD row ids leaves a concurrently-rewritten v2 chunk set dirty (Fix C isolation)', () => {
      const mem = makeMemory({ key: 'concurrent-key' })
      cache.upsertMemory(mem)
      // v1 written and its row ids captured (as a flush would, pre-await).
      const v1Ids = cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(2))
      // A concurrent v2 write lands during the (simulated) remote round-trip:
      // delete-then-insert => brand-new row ids, all dirty=1.
      const v2Ids = cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(3))
      expect(v2Ids.some((id) => v1Ids.includes(id))).toBe(false)

      // The flush completes and marks only the v1 ids it actually synced.
      cache.markChunksSynced(v1Ids)

      // v2 must STILL be dirty (its rows never synced) — not clobbered clean.
      const groups = cache.getDirtyChunkGroups()
      expect(groups).toContainEqual({ memoryId: mem.id, projectId: TEST_PROJECT })
      const stillDirty = cache.getDirtyChunkRows(mem.id)
      expect(stillDirty.map((r) => r.id).sort()).toEqual([...v2Ids].sort())
    })

    it('deleteChunksForMemory removes all of a memory\'s chunk rows (Fix F)', () => {
      const mem = makeMemory({ key: 'orphan-cleanup-key' })
      cache.upsertMemory(mem)
      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(3))
      expect(cache.getChunksForMemory(mem.id)).toHaveLength(3)

      cache.deleteChunksForMemory(mem.id)

      expect(cache.getChunksForMemory(mem.id)).toHaveLength(0)
      expect(cache.getDirtyChunkGroups().find((g) => g.memoryId === mem.id)).toBeUndefined()
    })

    it('deleteByKey also deletes the memory\'s mirror chunk rows (Fix F(a))', () => {
      const mem = makeMemory({ key: 'forget-with-chunks' })
      cache.upsertMemory(mem)
      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(2))
      expect(cache.getChunksForMemory(mem.id)).toHaveLength(2)

      cache.deleteByKey(TEST_PROJECT, 'forget-with-chunks')

      // No orphaned chunk rows survive the forget.
      expect(cache.getChunksForMemory(mem.id)).toHaveLength(0)
      expect(cache.getDirtyChunkGroups().find((g) => g.memoryId === mem.id)).toBeUndefined()
    })

    it('honors dirty=false for callers that do not want the row queued for remote sync', () => {
      const mem = makeMemory({ key: 'no-dirty-key' })
      cache.upsertMemory(mem)
      cache.upsertChunks(mem.id, TEST_PROJECT, makeChunks(1), false)

      const groups = cache.getDirtyChunkGroups()
      expect(groups.find((g) => g.memoryId === mem.id)).toBeUndefined()
      // Still retrievable locally even though not marked dirty.
      expect(cache.getChunksForMemory(mem.id)).toHaveLength(1)
    })

    it('round-trips embeddings through getChunksForMemory unchanged', () => {
      const mem = makeMemory({ key: 'embedding-roundtrip-key' })
      cache.upsertMemory(mem)
      const chunks = makeChunks(2)
      cache.upsertChunks(mem.id, TEST_PROJECT, chunks)

      const stored = cache.getChunksForMemory(mem.id)
      expect(stored[0].embedding).toEqual(chunks[0].embedding)
      expect(stored[1].embedding).toEqual(chunks[1].embedding)
    })
  })

  /**
   * Tests for getKeyById (Task 9 Phase 2): resolves (project_id, key) for a
   * locally-cached memory id. This is the lookup `SupabaseSync._flushDirtyChunks`
   * uses to resolve the AUTHORITATIVE remote id at flush time, since remote
   * memory upserts strip the local id and a local id routinely diverges from
   * the remote row's real id (same id-divergence class PR #70 fixed for
   * embedding updates).
   */
  describe('getKeyById', () => {
    it('returns the (project_id, key) pair for an existing memory id', () => {
      const mem = makeMemory({ key: 'lookup-key' })
      cache.upsertMemory(mem)

      const result = cache.getKeyById(mem.id)

      expect(result).toEqual({ projectId: TEST_PROJECT, key: 'lookup-key' })
    })

    it('returns null for an id that does not exist (never throws)', () => {
      const result = cache.getKeyById('no-such-memory-id')

      expect(result).toBeNull()
    })

    it('returns null for a memory that has been forget-deleted (row removed)', () => {
      const mem = makeMemory({ key: 'to-be-deleted' })
      cache.upsertMemory(mem)
      cache.deleteByKey(TEST_PROJECT, 'to-be-deleted')

      const result = cache.getKeyById(mem.id)

      expect(result).toBeNull()
    })
  })
})
