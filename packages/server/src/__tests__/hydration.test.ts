import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { shouldHydrate } from '../hydration'
import { SqliteCache } from '../cache/sqlite'
import { SupabaseSync } from '../sync/supabase-sync'

describe('shouldHydrate()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when lastSync is null (no prior sync)', () => {
    expect(shouldHydrate(null)).toBe(true)
  })

  it('returns true when lastSync is older than 60s', () => {
    const old = new Date(Date.now() - 61_000).toISOString()
    expect(shouldHydrate(old)).toBe(true)
  })

  it('returns true when lastSync is exactly 60s ago (boundary: >= ttl)', () => {
    const exact = new Date(Date.now() - 60_000).toISOString()
    expect(shouldHydrate(exact)).toBe(true)
  })

  it('returns false when lastSync is 59s ago (cache is fresh)', () => {
    const fresh = new Date(Date.now() - 59_000).toISOString()
    expect(shouldHydrate(fresh)).toBe(false)
  })

  it('returns false when lastSync is 1ms ago (very fresh)', () => {
    const veryFresh = new Date(Date.now() - 1).toISOString()
    expect(shouldHydrate(veryFresh)).toBe(false)
  })

  it('accepts custom ttlMs override', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
    // With 5s TTL, 10s ago is stale
    expect(shouldHydrate(tenSecondsAgo, 5_000)).toBe(true)
    // With 15s TTL, 10s ago is fresh
    expect(shouldHydrate(tenSecondsAgo, 15_000)).toBe(false)
  })

  it('handles ISO 8601 string with timezone correctly', () => {
    const recent = new Date(Date.now() - 5_000).toISOString()
    expect(shouldHydrate(recent)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 0.5.7 Task 1b: a teammate forgets the LAST memory in the project. The empty
// remote answer reconciles only after a separate exact count of 0 under a
// verified session; any doubt deletes nothing.
// ---------------------------------------------------------------------------
const EP = 'proj-empty'

type FakeOpts = {
  user?: boolean
  userError?: boolean
  countError?: boolean
  /** count the confirm query sees (defaults to the real row count) */
  confirmCount?: number
}

function makeEmptyFake(rows: Array<Record<string, unknown>>, o: FakeOpts = {}) {
  const headCalls: string[] = []
  const builder = (cols: string, opts?: { count?: string; head?: boolean }) => {
    const filters: Array<[string, string, unknown]> = []
    const b: Record<string, unknown> = {
      eq(c: string, v: unknown) { filters.push(['eq', c, v]); return b },
      gt(c: string, v: unknown) { filters.push(['gt', c, v]); return b },
      in(c: string, v: unknown) { filters.push(['in', c, v]); return b },
      order() { return b },
      range() { return b },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        const hit = rows.filter((r) => filters.every(([k, c, v]) =>
          k === 'eq' ? r[c] === v : k === 'gt' ? String(r[c]) > String(v) : k === 'in' ? (v as unknown[]).includes(r[c]) : true))
        let out: unknown
        if (opts?.head) {
          headCalls.push(cols)
          const isConfirm = cols === 'id' && filters.length === 1
          if (isConfirm && o.countError) out = { data: null, count: null, error: { message: 'denied' } }
          else out = { data: null, error: null, count: isConfirm && o.confirmCount !== undefined ? o.confirmCount : hit.length }
        } else {
          out = { data: hit.map((r) => ({ ...r })), error: null }
        }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return b
  }
  return {
    headCalls,
    supabase: {
      auth: {
        getUser: vi.fn(async () => o.userError
          ? { data: { user: null }, error: { message: 'Auth session missing!' } }
          : { data: { user: o.user === false ? null : { id: 'user-1' } }, error: null }),
      },
      from: () => ({
        select: builder,
        upsert: () => Promise.resolve({ error: null }),
      }),
    },
  }
}

function lm(key: string): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: EP, key, value: `v ${key}`, type: 'convention', source: 'manual',
    status: 'live', confidence: 1, filePaths: [], tags: [], createdAt: now, updatedAt: now,
  }
}

function remoteRow(key: string, updatedAt: string) {
  return {
    id: `r-${key}`, project_id: EP, key, value: `v ${key}`, type: 'convention', source: 'manual', status: 'live',
    file_paths: [], tags: [], confidence: 1, created_at: updatedAt, updated_at: updatedAt, encrypted: false,
  }
}

describe('hydrate: last memory forgotten by a teammate', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-hydration-empty-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(p)) fs.rmSync(p)
  })

  const syncFor = (fake: ReturnType<typeof makeEmptyFake>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new SupabaseSync(fake.supabase as any, cache, EP)

  it('full pull: confirmed empty (count 0, live session) removes clean rows, keeps dirty ones', async () => {
    cache.upsertMemory(lm('gone'), false)
    cache.upsertMemory(lm('unsynced'), true)
    // the push fails, so 'unsynced' stays dirty and the remote stays empty
    const fake = makeEmptyFake([])
    const from = fake.supabase.from
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(fake.supabase as any).from = () => ({ ...from(), upsert: () => Promise.resolve({ error: { message: 'offline' } }) })
    const n = await syncFor(fake).hydrate()
    expect(n).toBe(1)
    expect(cache.getByKey(EP, 'gone')).toBeNull()
    expect(cache.getByKey(EP, 'unsynced')).not.toBeNull()
    expect(fake.headCalls).toContain('id')
  })

  it('delta path: the teammate forgets the last row and the cache drops it', async () => {
    const rows = [remoteRow('only', '2026-11-03T10:00:00.000001+00:00')]
    const sync = syncFor(makeEmptyFake(rows))
    await sync.hydrate()
    expect(cache.getByKey(EP, 'only')).not.toBeNull()
    rows.splice(0, 1)
    await sync.hydrate()
    expect(cache.getByKey(EP, 'only')).toBeNull()
  })

  it.each([
    ['no authenticated user (dead session reads as empty under RLS)', { user: false }],
    ['getUser errors', { userError: true }],
    ['the confirming count fails (denied)', { countError: true }],
    ['the confirming count is not 0', { confirmCount: 3 }],
  ] as Array<[string, FakeOpts]>)('deletes nothing when %s', async (_label, opts) => {
    cache.upsertMemory(lm('a'), false)
    cache.upsertMemory(lm('b'), false)
    await syncFor(makeEmptyFake([], opts)).hydrate()
    expect(cache.getMemoryCount(EP)).toBe(2)
  })

  it('delta path: a denied confirming count keeps the row', async () => {
    const rows = [remoteRow('only', '2026-11-03T10:00:00.000001+00:00')]
    const opts: FakeOpts = {}
    const sync = syncFor(makeEmptyFake(rows, opts))
    await sync.hydrate()
    rows.splice(0, 1)
    opts.countError = true
    await sync.hydrate()
    expect(cache.getByKey(EP, 'only')).not.toBeNull()
  })

  it('a client with no auth API deletes nothing', async () => {
    cache.upsertMemory(lm('a'), false)
    const fake = makeEmptyFake([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (fake.supabase as any).auth
    await syncFor(fake).hydrate()
    expect(cache.getMemoryCount(EP)).toBe(1)
  })

  it('exposes the authenticated client through a public getter', () => {
    const fake = makeEmptyFake([])
    expect(syncFor(fake).client).toBe(fake.supabase)
  })
})
