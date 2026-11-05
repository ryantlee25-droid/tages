/**
 * 0.5.7 bugs 1 + 5 at the MCP tool layer.
 *
 * Bug 5: RLS turns a read-only member's UPDATE/DELETE into a silent 0-row
 * no-op. SupabaseSync reports that as `false`; tools must return isError with
 * a permission message, never "Verified"/"Deleted", and must not leave the
 * local cache claiming a change the shared store refused.
 *
 * Bug 1: every create/promote path calls embedOnWrite, after the remote row
 * exists (remoteUpdateEmbedding is an update, not an upsert).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const order: string[] = []
vi.mock('../tools/embed-on-write', () => ({
  embedOnWrite: vi.fn(async (memory: Memory) => { order.push(`embed:${memory.key}`) }),
}))

import { embedOnWrite } from '../tools/embed-on-write'
import { handleVerifyMemory } from '../tools/verify'
import { handleForget } from '../tools/forget'
import { handleConsolidate } from '../tools/dedup'
import { handleObserve } from '../tools/observe'
import { handleSessionEnd } from '../tools/session-end'
import { handleArchive } from '../tools/archive-manager'

const mockEmbed = vi.mocked(embedOnWrite)
const PROJECT = 'write-denied-project'

function mem(key: string, over: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: PROJECT, key, value: `value of ${key} long enough`,
    type: 'convention', source: 'agent', status: 'pending', confidence: 0.8,
    filePaths: [], tags: [], createdAt: now, updatedAt: now, ...over,
  }
}

function makeSync(opts: { verify?: boolean; del?: boolean; insert?: boolean } = {}) {
  return {
    remoteInsert: vi.fn(async (m: Memory) => { order.push(`insert:${m.key}`); return opts.insert ?? true }),
    remoteVerifyMemory: vi.fn(async () => opts.verify ?? true),
    remoteDelete: vi.fn(async () => opts.del ?? true),
    remoteUpdateEmbedding: vi.fn(async () => true),
    remoteUpsertChunks: vi.fn(async () => true),
  } as unknown as SupabaseSync & Record<'remoteInsert' | 'remoteVerifyMemory' | 'remoteDelete', ReturnType<typeof vi.fn>>
}

describe('MCP write tools: denied writes and embed-on-write wiring', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    order.length = 0
    mockEmbed.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    dbPath = path.join(os.tmpdir(), `tages-write-denied-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  describe('verify_memory', () => {
    it('denied: isError, no "Verified" text, local row stays pending, no embedding', async () => {
      cache.upsertMemory(mem('p1'), false)
      const sync = makeSync({ verify: false })
      const res = await handleVerifyMemory({ key: 'p1' }, PROJECT, cache, sync)
      expect(res.isError).toBe(true)
      expect(res.content[0].text).not.toMatch(/^Verified/)
      expect(res.content[0].text).toMatch(/Permission denied/)
      expect(cache.getByKey(PROJECT, 'p1')!.status).toBe('pending')
      expect(mockEmbed).not.toHaveBeenCalled()
    })

    it('allowed: promotes locally and generates an embedding for the row', async () => {
      cache.upsertMemory(mem('p2'), false)
      const sync = makeSync()
      const res = await handleVerifyMemory({ key: 'p2' }, PROJECT, cache, sync)
      expect(res.isError).toBeUndefined()
      expect(res.content[0].text).toMatch(/^Verified/)
      expect(cache.getByKey(PROJECT, 'p2')!.status).toBe('live')
      expect(mockEmbed).toHaveBeenCalledTimes(1)
      expect(mockEmbed.mock.calls[0][1]).toBe('value of p2 long enough')
    })

    it('a row that never reached the shared store is pushed live first', async () => {
      cache.upsertMemory(mem('u1'), true) // dirty: the original insert failed
      const sync = makeSync()
      const res = await handleVerifyMemory({ key: 'u1' }, PROJECT, cache, sync)
      expect(res.isError).toBeUndefined()
      expect(sync.remoteInsert).toHaveBeenCalledWith(expect.objectContaining({ key: 'u1', status: 'live' }))
      expect(cache.getByKey(PROJECT, 'u1')!.status).toBe('live')
    })

    it('an unsynced row whose push is refused is not reported verified', async () => {
      cache.upsertMemory(mem('u2'), true)
      const sync = makeSync({ insert: false })
      const res = await handleVerifyMemory({ key: 'u2' }, PROJECT, cache, sync)
      expect(res.isError).toBe(true)
      expect(sync.remoteVerifyMemory).not.toHaveBeenCalled()
      expect(cache.getByKey(PROJECT, 'u2')!.status).toBe('pending')
    })

    it('local-only project (no sync) still verifies and embeds', async () => {
      cache.upsertMemory(mem('p3'), false)
      const res = await handleVerifyMemory({ key: 'p3' }, PROJECT, cache, null)
      expect(res.content[0].text).toMatch(/^Verified/)
      expect(mockEmbed).toHaveBeenCalledTimes(1)
    })
  })

  describe('forget', () => {
    it('denied remote delete: isError, not "Deleted"', async () => {
      cache.upsertMemory(mem('f1', { status: 'live' }), false)
      const res = await handleForget({ key: 'f1' }, PROJECT, cache, makeSync({ del: false }))
      expect(res.isError).toBe(true)
      expect(res.content[0].text).not.toMatch(/^Deleted/)
      expect(res.content[0].text).toMatch(/Could not delete "f1" from the shared store/)
    })

    it('allowed: reports Deleted', async () => {
      cache.upsertMemory(mem('f2', { status: 'live' }), false)
      const res = await handleForget({ key: 'f2' }, PROJECT, cache, makeSync())
      expect(res.isError).toBeUndefined()
      expect(res.content[0].text).toBe('Deleted memory: "f2"')
    })
  })

  describe('consolidate_memories', () => {
    it('denied survivor write: isError and nothing changes locally', async () => {
      cache.upsertMemory(mem('s1', { status: 'live', value: 'use zod for validation' }), false)
      cache.upsertMemory(mem('v1', { status: 'live', value: 'use zod for runtime validation' }), false)
      const res = await handleConsolidate({ survivorKey: 's1', victimKey: 'v1' }, PROJECT, cache, makeSync({ insert: false }))
      expect(res.isError).toBe(true)
      expect(cache.getByKey(PROJECT, 'v1')).not.toBeNull()
      expect(cache.getByKey(PROJECT, 's1')!.value).toBe('use zod for validation')
    })

    it('denied victim delete: isError and the victim stays in the cache', async () => {
      cache.upsertMemory(mem('s2', { status: 'live', value: 'use zod for validation' }), false)
      cache.upsertMemory(mem('v2', { status: 'live', value: 'use zod for runtime validation' }), false)
      const sync = makeSync({ del: false })
      const res = await handleConsolidate({ survivorKey: 's2', victimKey: 'v2' }, PROJECT, cache, sync)
      expect(res.isError).toBe(true)
      expect(sync.remoteDelete).toHaveBeenCalledWith(PROJECT, 'v2')
      expect(cache.getByKey(PROJECT, 'v2')).not.toBeNull()
    })

    it('allowed: deletes the victim remotely through sync.remoteDelete', async () => {
      cache.upsertMemory(mem('s3', { status: 'live', value: 'use zod for validation' }), false)
      cache.upsertMemory(mem('v3', { status: 'live', value: 'use zod for runtime validation' }), false)
      const sync = makeSync()
      const res = await handleConsolidate({ survivorKey: 's3', victimKey: 'v3' }, PROJECT, cache, sync)
      expect(res.isError).toBeUndefined()
      expect(sync.remoteDelete).toHaveBeenCalledWith(PROJECT, 'v3')
      expect(cache.getByKey(PROJECT, 'v3')).toBeNull()
    })
  })

  describe('archive_memory', () => {
    it('pushes the archived status to the shared store when given a sync', async () => {
      cache.upsertMemory(mem('a1', { status: 'live' }), false)
      const sync = makeSync()
      const res = await handleArchive({ key: 'a1' }, PROJECT, cache, sync)
      expect(res.isError).toBeUndefined()
      expect(sync.remoteInsert).toHaveBeenCalledWith(expect.objectContaining({ key: 'a1', status: 'archived' }))
    })

    it('refused push: isError, and this machine is left unchanged (live, clean)', async () => {
      cache.upsertMemory(mem('a2', { status: 'live' }), false)
      const res = await handleArchive({ key: 'a2' }, PROJECT, cache, makeSync({ insert: false }))
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toMatch(/Nothing was changed/)
      expect(cache.getByKey(PROJECT, 'a2')!.status).toBe('live')
      expect(cache.getDirty().map((m) => m.key)).not.toContain('a2')
    })

    it('accepted push: archived locally and marked synced', async () => {
      cache.upsertMemory(mem('a3', { status: 'live' }), false)
      const res = await handleArchive({ key: 'a3' }, PROJECT, cache, makeSync())
      expect(res.isError).toBeUndefined()
      expect(cache.getByKey(PROJECT, 'a3')!.status).toBe('archived')
      expect(cache.getDirty().map((m) => m.key)).not.toContain('a3')
    })
  })

  describe('observe', () => {
    const obs = { observation: 'We always use snake_case for every API route name.' }

    it('embeds the new row after the remote insert', async () => {
      const sync = makeSync()
      await handleObserve(obs, PROJECT, cache, sync, 'user-1')
      expect(mockEmbed).toHaveBeenCalledTimes(1)
      const key = mockEmbed.mock.calls[0][0].key
      expect(order).toEqual([`insert:${key}`, `embed:${key}`])
      expect(mockEmbed.mock.calls[0][5]).toEqual({ timeoutMs: 10_000 })
    })

    it('auto-save refused by the shared store: isError and the local row is pending', async () => {
      const sync = makeSync({ verify: false })
      const res = await handleObserve(obs, PROJECT, cache, sync, 'user-1', 0.5)
      expect(res.isError).toBe(true)
      expect(res.content[0].text).toMatch(/auto-save did NOT apply/)
      const rows = cache.getAllForProject(PROJECT)
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')
      // A refused promotion must not leave verified_at behind for the next flush.
      expect(rows[0].verifiedAt ?? null).toBeNull()
    })

    it('auto-save allowed: row is live', async () => {
      const res = await handleObserve(obs, PROJECT, cache, makeSync(), 'user-1', 0.5)
      expect(res.isError).toBeUndefined()
      expect(cache.getAllForProject(PROJECT)[0].status).toBe('live')
    })
  })

  describe('session_end', () => {
    it('embeds every extracted row after its remote insert; rows stay pending', async () => {
      const sync = makeSync()
      await handleSessionEnd(
        { summary: 'We decided to use Zod for all runtime validation.\nWe always use pnpm workspaces for packages.' },
        PROJECT, cache, sync, 'user-1',
      )
      const rows = cache.getAllForProject(PROJECT)
      expect(rows.length).toBeGreaterThan(0)
      expect(mockEmbed).toHaveBeenCalledTimes(rows.length)
      for (const r of rows) {
        expect(r.status).toBe('pending')
        expect(order.indexOf(`insert:${r.key}`)).toBeLessThan(order.indexOf(`embed:${r.key}`))
      }
    })
  })
})
