/**
 * Remote-first tools must not leave a replayable WAL entry behind when the
 * shared store refuses the write.
 *
 * remoteInsert logs a pending WAL upsert before calling Supabase and only marks
 * it complete on success. archive_memory and verify_memory (unsynced row) leave
 * the local row unchanged on failure and tell the user nothing changed, so a
 * surviving entry would be replayed by recoverWAL on the next boot: the refused
 * change would land team-wide and overwrite any teammate edit made since.
 *
 * Real SupabaseSync + real on-disk WAL; only the Supabase client is faked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../tools/embed-on-write', () => ({ embedOnWrite: vi.fn(async () => {}) }))

import { SqliteCache } from '../cache/sqlite'
import { SyncWAL } from '../cache/sync-wal'
import { SupabaseSync } from '../sync/supabase-sync'
import { handleArchive } from '../tools/archive-manager'
import { handleVerifyMemory } from '../tools/verify'
import { handleConsolidate } from '../tools/dedup'

const PROJECT = 'wal-discard-project'

function mem(key: string, over: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: PROJECT, key, value: `value of ${key} long enough`,
    type: 'convention', source: 'agent', status: 'live', confidence: 0.8,
    filePaths: [], tags: [], createdAt: now, updatedAt: now, ...over,
  }
}

/** Every upsert returns the given error (null = success). */
function fakeClient(upsertError: { message: string } | null): SupabaseClient {
  return {
    from: () => ({
      upsert: async () => ({ error: upsertError }),
    }),
  } as unknown as SupabaseClient
}

describe('remote-first tools discard their WAL entry on a refused write', () => {
  let cache: SqliteCache
  let dbPath: string
  let walPath: string

  /** Reads the WAL the way recoverWAL does on the next boot (separate instance). */
  function pendingFor(memoryId: string) {
    const reader = new SyncWAL(walPath)
    try {
      return reader.getIncomplete().filter((e) => e.memoryId === memoryId)
    } finally {
      reader.close()
    }
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = randomUUID()
    dbPath = path.join(os.tmpdir(), `tages-wal-discard-${id}.db`)
    walPath = path.join(os.tmpdir(), `tages-wal-discard-${id}-wal.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cache.close()
    for (const p of [dbPath, walPath]) { try { fs.unlinkSync(p) } catch {} }
  })

  it('control: a failed remoteInsert on its own leaves a pending WAL entry', async () => {
    const m = mem('c1')
    const sync = new SupabaseSync(fakeClient({ message: 'denied' }), cache, PROJECT, walPath)
    expect(await sync.remoteInsert(m)).toBe(false)
    expect(pendingFor(m.id)).toHaveLength(1)
  })

  it('archive refused: no WAL entry survives to replay "archived" on next boot', async () => {
    const m = mem('a1')
    cache.upsertMemory(m, false)
    const sync = new SupabaseSync(fakeClient({ message: 'denied' }), cache, PROJECT, walPath)

    const res = await handleArchive({ key: 'a1' }, PROJECT, cache, sync)

    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/Nothing was changed/)
    expect(cache.getByKey(PROJECT, 'a1')!.status).toBe('live')
    expect(pendingFor(m.id)).toEqual([])
  })

  it('archive accepted: the WAL entry is completed, nothing pending', async () => {
    const m = mem('a2')
    cache.upsertMemory(m, false)
    const sync = new SupabaseSync(fakeClient(null), cache, PROJECT, walPath)

    const res = await handleArchive({ key: 'a2' }, PROJECT, cache, sync)

    expect(res.isError).toBeUndefined()
    expect(cache.getByKey(PROJECT, 'a2')!.status).toBe('archived')
    expect(pendingFor(m.id)).toEqual([])
  })

  it('consolidate refused: no WAL entry survives to replay the merged survivor', async () => {
    const s = mem('s1', { value: 'use zod for validation' })
    const v = mem('d1', { value: 'use zod for runtime validation' })
    cache.upsertMemory(s, false)
    cache.upsertMemory(v, false)
    const sync = new SupabaseSync(fakeClient({ message: 'denied' }), cache, PROJECT, walPath)

    const res = await handleConsolidate({ survivorKey: 's1', victimKey: 'd1' }, PROJECT, cache, sync)

    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/Nothing was changed/)
    expect(cache.getByKey(PROJECT, 's1')!.value).toBe('use zod for validation')
    expect(pendingFor(s.id)).toEqual([])
  })

  it('verify of an unsynced row refused: no WAL entry survives to replay it as live', async () => {
    const m = mem('v1', { status: 'pending' })
    cache.upsertMemory(m, true) // dirty: never reached the shared store
    const sync = new SupabaseSync(fakeClient({ message: 'denied' }), cache, PROJECT, walPath)

    const res = await handleVerifyMemory({ key: 'v1' }, PROJECT, cache, sync)

    expect(res.isError).toBe(true)
    expect(cache.getByKey(PROJECT, 'v1')!.status).toBe('pending')
    expect(pendingFor(m.id)).toEqual([])
  })
})
