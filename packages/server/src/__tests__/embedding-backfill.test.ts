/**
 * 0.5.7 Task 1b (bug 1): bounded boot embedding backfill.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'

const gen = vi.hoisted(() => ({ generateEmbedding: vi.fn(), generateChunkEmbeddings: vi.fn() }))
vi.mock('../embeddings', () => gen)

import { SqliteCache } from '../cache/sqlite'
import { encryptValue } from '../crypto/encryption'
import type { SupabaseSync } from '../sync/supabase-sync'
import { runEmbeddingBackfill, BACKFILL_LIMIT, resetBackfillFailures } from '../sync/embedding-backfill'

const PROJECT = 'backfill-project'

function mem(over: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: PROJECT, key: `k-${randomUUID().slice(0, 8)}`, value: 'use pnpm',
    type: 'convention', source: 'manual', status: 'live', confidence: 1,
    filePaths: [], tags: [], createdAt: now, updatedAt: now, ...over,
  }
}

function embeddingOf(cache: SqliteCache, key: string): number[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (cache as any).db.prepare('SELECT embedding FROM memories WHERE project_id = ? AND key = ?').get(PROJECT, key) as { embedding: string | null } | undefined
  return row?.embedding ? JSON.parse(row.embedding) : null
}

function fakeSync() {
  return {
    remoteUpdateEmbedding: vi.fn(async () => true),
    remoteUpsertChunks: vi.fn(async () => true),
    client: undefined,
  }
}

describe('runEmbeddingBackfill', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-backfill-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
    gen.generateEmbedding.mockReset().mockResolvedValue([0.1, 0.2, 0.3])
    gen.generateChunkEmbeddings.mockReset().mockResolvedValue(null)
    resetBackfillFailures()
  })

  afterEach(() => {
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(p)) fs.rmSync(p)
  })

  it('embeds a live row with no embedding, locally and through remoteUpdateEmbedding', async () => {
    cache.upsertMemory(mem({ key: 'needs-vector' }), false)
    const sync = fakeSync()
    const n = await runEmbeddingBackfill(PROJECT, cache, sync as unknown as SupabaseSync)
    expect(n).toBe(1)
    expect(embeddingOf(cache, 'needs-vector')).toEqual([0.1, 0.2, 0.3])
    expect(sync.remoteUpdateEmbedding).toHaveBeenCalledWith(PROJECT, 'needs-vector', [0.1, 0.2, 0.3])
    expect(gen.generateEmbedding.mock.calls[0][0]).toBe('use pnpm')
  })

  it('processes at most 20 rows by default', async () => {
    for (let i = 0; i < 25; i++) cache.upsertMemory(mem(), false)
    const n = await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)
    expect(BACKFILL_LIMIT).toBe(20)
    expect(n).toBe(20)
    expect(gen.generateEmbedding).toHaveBeenCalledTimes(20)
    expect(cache.getLiveMissingEmbedding(PROJECT, 100)).toHaveLength(5)
  })

  it('honours a custom limit', async () => {
    for (let i = 0; i < 5; i++) cache.upsertMemory(mem(), false)
    expect(await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync, undefined, { limit: 2 })).toBe(2)
  })

  it('skips pending rows and rows that already have an embedding', async () => {
    cache.upsertMemory(mem({ key: 'pending', status: 'pending' }), false)
    cache.upsertMemory(mem({ key: 'has' }), false)
    cache.setEmbedding(PROJECT, 'has', [9, 9])
    expect(await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)).toBe(0)
    expect(gen.generateEmbedding).not.toHaveBeenCalled()
  })

  it('a null embedding writes nothing and does not push', async () => {
    gen.generateEmbedding.mockResolvedValue(null)
    cache.upsertMemory(mem({ key: 'nullvec' }), false)
    const sync = fakeSync()
    await runEmbeddingBackfill(PROJECT, cache, sync as unknown as SupabaseSync)
    expect(embeddingOf(cache, 'nullvec')).toBeNull()
    expect(sync.remoteUpdateEmbedding).not.toHaveBeenCalled()
  })

  it('never rejects: provider throws, or the cache read throws', async () => {
    gen.generateEmbedding.mockRejectedValue(new Error('provider down'))
    cache.upsertMemory(mem(), false)
    await expect(runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)).resolves.toBe(1)

    const broken = { getLiveMissingEmbedding: () => { throw new Error('db closed') } } as unknown as SqliteCache
    await expect(runEmbeddingBackfill(PROJECT, broken, null)).resolves.toBe(0)
  })

  it('one hung row does not stall the batch (per-row cap)', async () => {
    cache.upsertMemory(mem({ key: 'a', updatedAt: '2026-11-03T10:00:02.000Z' }), false)
    cache.upsertMemory(mem({ key: 'b', updatedAt: '2026-11-03T10:00:01.000Z' }), false)
    gen.generateEmbedding
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue([1, 2])
    const n = await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync, undefined, { rowTimeoutMs: 20 })
    expect(n).toBe(2)
    expect(embeddingOf(cache, 'b')).toEqual([1, 2])
  })

  describe('starvation (S1)', () => {
    const prevKey = process.env.TAGES_ENCRYPTION_KEY
    afterEach(() => {
      if (prevKey === undefined) delete process.env.TAGES_ENCRYPTION_KEY
      else process.env.TAGES_ENCRYPTION_KEY = prevKey
    })

    it('20 newest undecryptable rows do not starve older embeddable rows', async () => {
      delete process.env.TAGES_ENCRYPTION_KEY
      for (let i = 0; i < 20; i++) {
        cache.upsertMemory(mem({ key: `enc-${i}`, value: 'enc:v1:AAAA', encrypted: true, updatedAt: `2026-06-01T00:00:${String(i).padStart(2, '0')}.000Z` }), false)
      }
      cache.upsertMemory(mem({ key: 'older-plain', value: 'use pnpm', updatedAt: '2026-01-01T00:00:00.000Z' }), false)
      const n = await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)
      expect(n).toBe(1)
      expect(gen.generateEmbedding).toHaveBeenCalledTimes(1)
      expect(embeddingOf(cache, 'older-plain')).toEqual([0.1, 0.2, 0.3])
    })

    it('rows the provider refuses are not retried by a second run in the same process', async () => {
      gen.generateEmbedding.mockImplementation(async (text: string) => (text === 'refused' ? null : [7, 7]))
      for (let i = 0; i < 3; i++) {
        cache.upsertMemory(mem({ key: `refused-${i}`, value: 'refused', updatedAt: `2026-06-01T00:00:0${i}.000Z` }), false)
      }
      cache.upsertMemory(mem({ key: 'older', value: 'fine', updatedAt: '2026-01-01T00:00:00.000Z' }), false)
      expect(await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync, undefined, { limit: 3 })).toBe(3)
      expect(embeddingOf(cache, 'older')).toBeNull()
      expect(await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync, undefined, { limit: 3 })).toBe(1)
      expect(embeddingOf(cache, 'older')).toEqual([7, 7])
      expect(gen.generateEmbedding).toHaveBeenCalledTimes(4)
    })

    it('never makes more than `limit` provider calls even with a wide window', async () => {
      for (let i = 0; i < 150; i++) cache.upsertMemory(mem(), false)
      expect(await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)).toBe(BACKFILL_LIMIT)
      expect(gen.generateEmbedding).toHaveBeenCalledTimes(BACKFILL_LIMIT)
    })
  })

  describe('encrypted rows', () => {
    const KEY_HEX = 'ab'.repeat(32)
    const prev = process.env.TAGES_ENCRYPTION_KEY
    afterEach(() => {
      if (prev === undefined) delete process.env.TAGES_ENCRYPTION_KEY
      else process.env.TAGES_ENCRYPTION_KEY = prev
    })

    it('embeds the decrypted plaintext, never the ciphertext', async () => {
      process.env.TAGES_ENCRYPTION_KEY = KEY_HEX
      const cipher = encryptValue('secret deploy rule', Buffer.from(KEY_HEX, 'hex'))
      cache.upsertMemory(mem({ key: 'enc', value: cipher, encrypted: true }), false)
      const n = await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)
      expect(n).toBe(1)
      expect(gen.generateEmbedding.mock.calls[0][0]).toBe('secret deploy rule')
      expect(embeddingOf(cache, 'enc')).toEqual([0.1, 0.2, 0.3])
    })

    it('without the key it skips the row: no provider call, no embedding, not counted', async () => {
      delete process.env.TAGES_ENCRYPTION_KEY
      cache.upsertMemory(mem({ key: 'enc-nokey', value: 'enc:v1:AAAA', encrypted: true }), false)
      const sync = fakeSync()
      const n = await runEmbeddingBackfill(PROJECT, cache, sync as unknown as SupabaseSync)
      expect(n).toBe(0)
      expect(gen.generateEmbedding).not.toHaveBeenCalled()
      expect(sync.remoteUpdateEmbedding).not.toHaveBeenCalled()
      expect(embeddingOf(cache, 'enc-nokey')).toBeNull()
    })

    it('a corrupt ciphertext is skipped and the next row is still embedded', async () => {
      process.env.TAGES_ENCRYPTION_KEY = KEY_HEX
      cache.upsertMemory(mem({ key: 'older-good', value: 'plain ok', updatedAt: '2026-01-01T00:00:00.000Z' }), false)
      cache.upsertMemory(mem({ key: 'newer-bad', value: 'enc:v1:AAAA', encrypted: true, updatedAt: '2026-06-01T00:00:00.000Z' }), false)
      const n = await runEmbeddingBackfill(PROJECT, cache, fakeSync() as unknown as SupabaseSync)
      expect(n).toBe(1)
      expect(embeddingOf(cache, 'newer-bad')).toBeNull()
      expect(embeddingOf(cache, 'older-good')).toEqual([0.1, 0.2, 0.3])
    })
  })
})
