import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import { SupabaseSync, maxTimestamp, pgInList } from '../sync/supabase-sync'

/**
 * 0.5.7 Task 1a: hydrate reconciliation (bugs 1, 2, 3, 5, 10).
 *
 * The fake below models the PostgREST behaviour the fixes depend on:
 * - a response is capped at 1000 rows unless `.range()` pages through,
 * - `updated_at` is server-issued with microseconds and a `+00:00` offset,
 * - RLS can make an UPDATE/DELETE match zero rows with no error.
 */

const PROJECT = 'proj-hydrate'
const PG_CAP = 1000

type Row = Record<string, unknown> & { id: string; project_id: string; key: string; updated_at: string }

let tick = 0
/** Server clock base: in the past, so the W1 clamp (watermark <= local now) never bites by accident. */
const SERVER_EPOCH = '2026-06-01T10:00:00.000Z'
/** Monotonic server timestamps with microsecond precision. */
function serverNow(): string {
  tick++
  const base = Date.parse(SERVER_EPOCH) + tick
  const iso = new Date(base).toISOString().replace('Z', '')
  return `${iso}${String(tick % 1000).padStart(3, '0')}+00:00`
}

/** Postgres-like compare: timestamps by instant (then string for sub-ms), everything else by code point. */
function cmp(a: unknown, b: unknown): number {
  const x = String(a)
  const y = String(b)
  const tx = Date.parse(x)
  const ty = Date.parse(y)
  if (!Number.isNaN(tx) && !Number.isNaN(ty) && tx !== ty) return tx < ty ? -1 : 1
  return x < y ? -1 : x > y ? 1 : 0
}

/** Parse a PostgREST `("a","b")` in-list literal. */
function parseInList(v: string): string[] {
  return [...v.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
}

function makeFake(opts: { denyWrites?: boolean } = {}) {
  const rows: Row[] = []
  const calls: Array<{ op: string; filters: Array<[string, string, unknown]> }> = []
  let failSelects = false
  /** Runs once per non-head select, AFTER its answer is computed and BEFORE it resolves. */
  let afterSelect: ((n: number, filters: Array<[string, string, unknown]>) => void) | null = null
  let selectN = 0
  /** When set, every request hangs until its abort signal fires. */
  let hang = false
  /** PostgREST db-max-rows: every page is capped here regardless of limit(). */
  let pgCap = PG_CAP
  let failUpserts = false

  function addRow(over: Partial<Row> & { key: string }): Row {
    const row: Row = {
      id: `remote-${randomUUID()}`,
      project_id: PROJECT,
      value: `value of ${over.key}`,
      type: 'convention',
      source: 'manual',
      status: 'live',
      agent_name: null,
      file_paths: [],
      tags: [],
      confidence: 1,
      created_at: '2026-11-01T00:00:00+00:00',
      updated_at: serverNow(),
      created_by: null,
      updated_by: null,
      encrypted: false,
      ...over,
    } as Row
    rows.push(row)
    return row
  }

  function builder(table: string, op: string, payload?: unknown, opOpts?: { count?: string; head?: boolean }) {
    const filters: Array<[string, string, unknown]> = []
    const orders: string[] = []
    let range: [number, number] | null = null
    let limit: number | null = null
    let signal: AbortSignal | null = null
    const matches = (r: Row) =>
      filters.every(([kind, col, val]) => {
        if (kind === 'eq') return r[col] === val
        if (kind === 'gt') return cmp(r[col], val) > 0
        if (kind === 'in') return (val as unknown[]).includes(r[col])
        if (kind === 'not.in') return !parseInList(String(val)).includes(String(r[col]))
        return true
      })
    const b: Record<string, unknown> = {
      eq(col: string, val: unknown) { filters.push(['eq', col, val]); return b },
      gt(col: string, val: unknown) { filters.push(['gt', col, val]); return b },
      in(col: string, val: unknown[]) { filters.push(['in', col, val]); return b },
      not(col: string, operator: string, val: unknown) { filters.push([`not.${operator}`, col, val]); return b },
      order(col: string) { orders.push(col); return b },
      range(from: number, to: number) { range = [from, to]; return b },
      limit(n: number) { limit = n; return b },
      abortSignal(s: AbortSignal) { signal = s; return b },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        calls.push({ op: `${table}.${op}`, filters: [...filters] })
        if (hang) {
          // Like postgrest-js: an aborted fetch resolves as { error }.
          return new Promise((res) => {
            signal?.addEventListener('abort', () =>
              res({ data: null, error: { message: 'AbortError: The operation was aborted.' }, count: null }),
            )
          }).then(resolve, reject)
        }
        let result: unknown
        if (op === 'select') {
          if (failSelects) {
            result = { data: null, error: { message: 'boom' }, count: null }
          } else {
            let hit = rows.filter(matches)
            for (const col of [...orders].reverse()) {
              hit = [...hit].sort((x, y) => cmp(x[col], y[col]))
            }
            if (opOpts?.head) {
              result = { data: null, error: null, count: hit.length }
            } else {
              const [from, to] = range ?? [0, pgCap - 1]
              const cap = Math.min(pgCap, limit ?? pgCap)
              const page = hit.slice(from, Math.min(to + 1, from + cap))
              result = { data: page.map((r) => ({ ...r })), error: null, count: null }
              selectN++
              afterSelect?.(selectN, filters)
            }
          }
        } else if (op === 'update') {
          const hit = opts.denyWrites ? [] : rows.filter(matches)
          for (const r of hit) Object.assign(r, payload, { updated_at: serverNow() })
          result = { data: null, error: null, count: opOpts?.count ? hit.length : null }
        } else if (op === 'delete') {
          const hit = opts.denyWrites ? [] : rows.filter(matches)
          for (const r of hit) rows.splice(rows.indexOf(r), 1)
          result = { data: null, error: null, count: opOpts?.count ? hit.length : null }
        } else {
          result = { data: null, error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }

  const supabase = {
    from: vi.fn((table: string) => ({
      select: (_cols: string, o?: { count?: string; head?: boolean }) => builder(table, 'select', undefined, o),
      update: (payload: unknown, o?: { count?: string }) => builder(table, 'update', payload, o),
      delete: (o?: { count?: string }) => builder(table, 'delete', undefined, o),
      upsert: (input: Record<string, unknown> | Record<string, unknown>[]) => {
        calls.push({ op: `${table}.upsert`, filters: [] })
        if (failUpserts) return Promise.resolve({ error: { message: 'new row violates row-level security policy' } })
        const list = Array.isArray(input) ? input : [input]
        for (const incoming of list) {
          const existing = rows.find((r) => r.project_id === incoming.project_id && r.key === incoming.key)
          if (existing) Object.assign(existing, incoming, { id: existing.id, updated_at: serverNow() })
          // INSERT keeps the writer's updated_at: the trigger is BEFORE UPDATE only.
          else rows.push({ ...incoming, id: `remote-${randomUUID()}`, updated_at: incoming.updated_at ?? serverNow() } as Row)
        }
        return Promise.resolve({ error: null })
      },
    })),
  }

  return {
    supabase,
    rows,
    calls,
    addRow,
    setFailSelects(v: boolean) { failSelects = v },
    setAfterSelect(fn: ((n: number, filters: Array<[string, string, unknown]>) => void) | null) { afterSelect = fn; selectN = 0 },
    setHang(v: boolean) { hang = v },
    setPgCap(n: number) { pgCap = n },
    setFailUpserts(v: boolean) { failUpserts = v },
  }
}

function localMemory(over: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    projectId: PROJECT,
    key: 'k',
    value: 'v',
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1,
    filePaths: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  }
}

function embeddingOf(cache: SqliteCache, key: string): number[] | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (cache as any).db
  const row = db.prepare('SELECT embedding FROM memories WHERE project_id = ? AND key = ?').get(PROJECT, key) as
    | { embedding: string | null }
    | undefined
  return row?.embedding ? (JSON.parse(row.embedding) as number[]) : null
}

describe('hydrate reconcile (0.5.7 Task 1a)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-hydrate-reconcile-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(p)) fs.rmSync(p)
    }
    vi.useRealTimers()
  })

  function makeSync(fake: ReturnType<typeof makeFake>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new SupabaseSync(fake.supabase as any, cache, PROJECT)
  }

  // (a) embeddings
  describe('(a) embedding carry-through', () => {
    it('writes the remote embedding into the cache on hydrate', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'emb', embedding: '[0.1,0.2,0.3]' })
      await makeSync(fake).hydrate()
      expect(embeddingOf(cache, 'emb')).toEqual([0.1, 0.2, 0.3])
    })

    it('a hydrated embedding makes the row reachable by local semantic recall', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'emb', value: 'unrelated words', embedding: '[1,0,0]' })
      await makeSync(fake).hydrate()
      const hits = cache.scoredQuery(PROJECT, 'zzz-no-text-match', [1, 0, 0])
      expect(hits.map((h) => h.memory.key)).toContain('emb')
    })

    it('clears a stale local embedding when the value changes and the remote has none', () => {
      cache.upsertMemoryWithEmbedding(localMemory({ key: 'x', value: 'old text' }), [1, 2, 3], false)
      cache.hydrateFromRemote([localMemory({ key: 'x', value: 'new text' })])
      expect(embeddingOf(cache, 'x')).toBeNull()
    })

    it('keeps the local embedding when the value is unchanged and the remote has none', () => {
      cache.upsertMemoryWithEmbedding(localMemory({ key: 'x', value: 'same' }), [1, 2, 3], false)
      cache.hydrateFromRemote([localMemory({ key: 'x', value: 'same', tags: ['t'] })])
      expect(embeddingOf(cache, 'x')).toEqual([1, 2, 3])
    })

    it('replaces the local embedding with the remote one', () => {
      cache.upsertMemoryWithEmbedding(localMemory({ key: 'x', value: 'a' }), [1, 2, 3], false)
      cache.hydrateFromRemote([localMemory({ key: 'x', value: 'b', embedding: [9, 9] })])
      expect(embeddingOf(cache, 'x')).toEqual([9, 9])
    })
  })

  // (b) deletion reconcile
  describe('(b) deletions from the shared store', () => {
    it('deletes a clean local row the remote no longer has (full pull)', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'keep' })
      cache.upsertMemory(localMemory({ key: 'forgotten' }), false)
      await makeSync(fake).hydrate()
      expect(cache.getByKey(PROJECT, 'forgotten')).toBeNull()
      expect(cache.getByKey(PROJECT, 'keep')).not.toBeNull()
    })

    it('deletes a forgotten row on the delta path (count mismatch -> listing)', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(2)

      // Teammate forgets "b".
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'b'), 1)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).toBeNull()
      expect(cache.getByKey(PROJECT, 'a')).not.toBeNull()
    })

    it('keeps a dirty local row absent remotely, and pushes it first', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'remote-row' })
      cache.upsertMemory(localMemory({ key: 'unsynced', value: 'mine' }), true)
      await makeSync(fake).hydrate()
      expect(cache.getByKey(PROJECT, 'unsynced')?.value).toBe('mine')
      // push-before-pull: the dirty row reached the remote
      expect(fake.rows.some((r) => r.key === 'unsynced')).toBe(true)
    })

    it('keeps a row that is dirty because its push failed, even when the remote lacks it', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'remote-row' })
      // Make the push fail so the row stays dirty.
      const origFrom = fake.supabase.from
      fake.supabase.from = vi.fn((table: string) => {
        const t = origFrom(table)
        return { ...t, upsert: () => Promise.resolve({ error: { message: 'offline' } }) }
      }) as unknown as typeof origFrom
      cache.upsertMemory(localMemory({ key: 'stuck', value: 'mine' }), true)
      await makeSync(fake).hydrate()
      expect(cache.getByKey(PROJECT, 'stuck')?.value).toBe('mine')
      expect(cache.getDirty().map((m) => m.key)).toContain('stuck')
    })

    it('never mass-deletes on an empty remote answer (dead session under RLS)', async () => {
      const fake = makeFake()
      cache.upsertMemory(localMemory({ key: 'a' }), false)
      cache.upsertMemory(localMemory({ key: 'b' }), false)
      await makeSync(fake).hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(2)
    })

    it('deletes nothing when a listing page fails', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'b'), 1)
      fake.setFailSelects(true)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).not.toBeNull()
    })

    it('fetches a remote row inserted with an old updated_at (missed by the delta window)', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.addRow({ key: 'late', updated_at: '2026-01-01T00:00:00+00:00' })
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'late')).not.toBeNull()
    })
  })

  // (c) status changes
  describe('(c) remote status changes leave ranked recall', () => {
    for (const status of ['archived', 'pending'] as const) {
      it(`a row moved to ${status} stops appearing in scoredQuery`, async () => {
        const fake = makeFake()
        fake.addRow({ key: 'rule', value: 'use tabs', embedding: '[1,0]' })
        const sync = makeSync(fake)
        await sync.hydrate()
        expect(cache.scoredQuery(PROJECT, 'tabs', [1, 0]).map((r) => r.memory.key)).toContain('rule')

        const row = fake.rows.find((r) => r.key === 'rule')!
        row.status = status
        row.updated_at = serverNow()
        await sync.hydrate()
        expect(cache.scoredQuery(PROJECT, 'tabs', [1, 0]).map((r) => r.memory.key)).not.toContain('rule')
      })
    }
  })

  // (d) watermark
  describe('(d) watermark', () => {
    it('uses the max remote updated_at, not the local clock', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a', updated_at: '2026-06-01T09:00:00.000001+00:00' })
      fake.addRow({ key: 'b', updated_at: '2026-06-01T09:00:00.123456+00:00' })
      await makeSync(fake).hydrate()
      expect(cache.getRemoteWatermark(PROJECT)).toBe('2026-06-01T09:00:00.123456+00:00')
    })

    it('a skewed-ahead local clock cannot hide a teammate edit', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a', value: 'v1' })
      const sync = makeSync(fake)
      // Simulate a local clock a day ahead of the server.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
      await sync.hydrate()
      vi.useRealTimers()

      const row = fake.rows.find((r) => r.key === 'a')!
      row.value = 'v2'
      row.updated_at = serverNow()
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'a')?.value).toBe('v2')
    })

    it('ignores a legacy local-clock last_synced_at and re-pulls in full once', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a', value: 'remote' })
      cache.upsertMemory(localMemory({ key: 'a', value: 'stale' }), false)
      cache.setLastSyncedAt(PROJECT, '2099-01-01T00:00:00.000Z', 1)
      await makeSync(fake).hydrate()
      expect(cache.getByKey(PROJECT, 'a')?.value).toBe('remote')
      expect(cache.getRemoteWatermark(PROJECT)).not.toBeNull()
    })

    it('holds the watermark when a dirty row was skipped', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a', value: 'v1' })
      const sync = makeSync(fake)
      await sync.hydrate()
      const before = cache.getRemoteWatermark(PROJECT)

      // A teammate edit lands, but our local copy is dirty and its push fails.
      const row = fake.rows.find((r) => r.key === 'a')!
      row.value = 'teammate'
      row.updated_at = serverNow()
      cache.upsertMemory({ ...cache.getByKey(PROJECT, 'a')!, value: 'mine' }, true)
      const origFrom = fake.supabase.from
      fake.supabase.from = vi.fn((table: string) => {
        const t = origFrom(table)
        return { ...t, upsert: () => Promise.resolve({ error: { message: 'offline' } }) }
      }) as unknown as typeof origFrom

      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'a')?.value).toBe('mine')
      expect(cache.getRemoteWatermark(PROJECT)).toBe(before)
    })

    it('maxTimestamp keeps microseconds when instants tie at ms precision', () => {
      expect(maxTimestamp(null, ['2026-11-03T09:00:00.123+00:00', '2026-11-03T09:00:00.123456+00:00'])).toBe(
        '2026-11-03T09:00:00.123456+00:00',
      )
    })

    it('fast path: an unchanged project runs only the two head counts', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.calls.length = 0
      expect(await sync.hydrate()).toBe(0)
      expect(fake.calls).toHaveLength(2)
    })
  })

  // (e) pagination
  describe('(e) pagination', () => {
    it('pulls all 1500 remote rows, not the first 1000', async () => {
      const fake = makeFake()
      for (let i = 0; i < 1500; i++) fake.addRow({ key: `k-${String(i).padStart(4, '0')}` })
      const n = await makeSync(fake).hydrate()
      expect(n).toBe(1500)
      expect(cache.getMemoryCount(PROJECT)).toBe(1500)
    })

    it('a deletion among 1500 rows is reconciled without deleting rows past the first page', async () => {
      const fake = makeFake()
      for (let i = 0; i < 1500; i++) fake.addRow({ key: `k-${String(i).padStart(4, '0')}` })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'k-1400'), 1)
      await sync.hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(1499)
      expect(cache.getByKey(PROJECT, 'k-1400')).toBeNull()
      expect(cache.getByKey(PROJECT, 'k-1499')).not.toBeNull()
    })

    it('remoteGetByKeys batches 250 keys into 3 requests', async () => {
      const fake = makeFake()
      const keys: string[] = []
      for (let i = 0; i < 250; i++) {
        fake.addRow({ key: `b-${i}` })
        keys.push(`b-${i}`)
      }
      fake.calls.length = 0
      const got = await makeSync(fake).remoteGetByKeys(PROJECT, keys)
      expect(got?.size).toBe(250)
      expect(fake.calls.filter((c) => c.op === 'memories.select')).toHaveLength(3)
      expect(got?.get('b-7')?.key).toBe('b-7')
    })

    it('remoteGetByKeys returns null on error', async () => {
      const fake = makeFake()
      fake.setFailSelects(true)
      expect(await makeSync(fake).remoteGetByKeys(PROJECT, ['a'])).toBeNull()
    })
  })

  // (f) zero-row writes
  describe('(f) remoteVerifyMemory / remoteDelete detect RLS no-ops', () => {
    it('verify: true when the row changed', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'p', status: 'pending' })
      expect(await makeSync(fake).remoteVerifyMemory(PROJECT, 'p', '2026-11-03T00:00:00Z')).toBe(true)
      expect(fake.rows[0].status).toBe('live')
    })

    it('verify: false when a visible row was not changed (read-only member)', async () => {
      const fake = makeFake({ denyWrites: true })
      fake.addRow({ key: 'p', status: 'pending' })
      expect(await makeSync(fake).remoteVerifyMemory(PROJECT, 'p', '2026-11-03T00:00:00Z')).toBe(false)
    })

    it('verify: false when the key is not in the shared store (nothing was verified)', async () => {
      const fake = makeFake()
      expect(await makeSync(fake).remoteVerifyMemory(PROJECT, 'missing', '2026-11-03T00:00:00Z')).toBe(false)
    })

    it('verify: false on error', async () => {
      const supabase = {
        from: () => ({
          update: () => {
            const b = { eq: () => b, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: { message: 'x' }, count: null }).then(r) }
            return b
          },
        }),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sync = new SupabaseSync(supabase as any, cache, PROJECT)
      expect(await sync.remoteVerifyMemory(PROJECT, 'p', 'now')).toBe(false)
    })

    it('delete: true when the row was deleted', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'd' })
      expect(await makeSync(fake).remoteDelete(PROJECT, 'd')).toBe(true)
      expect(fake.rows).toHaveLength(0)
    })

    it('delete: true when the row never existed remotely', async () => {
      const fake = makeFake({ denyWrites: true })
      expect(await makeSync(fake).remoteDelete(PROJECT, 'never')).toBe(true)
    })

    it('delete: false when the row is still there (denied)', async () => {
      const fake = makeFake({ denyWrites: true })
      fake.addRow({ key: 'd' })
      expect(await makeSync(fake).remoteDelete(PROJECT, 'd')).toBe(false)
    })

    it('delete: false on error', async () => {
      const supabase = {
        from: () => ({
          delete: () => {
            const b = { eq: () => b, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: { message: 'x' }, count: null }).then(r) }
            return b
          },
        }),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sync = new SupabaseSync(supabase as any, cache, PROJECT)
      expect(await sync.remoteDelete(PROJECT, 'd')).toBe(false)
    })
  })

  // (g) hydrateIfStale
  describe('(g) hydrateIfStale', () => {
    it('is single-flight: concurrent callers share one hydrate', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      const spy = vi.spyOn(sync, 'hydrate')
      await Promise.all([sync.hydrateIfStale(15_000), sync.hydrateIfStale(15_000), sync.hydrateIfStale(15_000)])
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('does not query inside the freshness window', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.calls.length = 0
      await sync.hydrateIfStale(15_000)
      expect(fake.calls).toHaveLength(0)
    })

    it('hydrates again once the window has passed', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      fake.addRow({ key: 'b' })
      await sync.hydrateIfStale(0)
      expect(cache.getByKey(PROJECT, 'b')).not.toBeNull()
    })

    it('times out open: resolves after timeoutMs while the hydrate hangs', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      vi.spyOn(sync, 'hydrate').mockImplementation(() => new Promise(() => {}))
      const t0 = Date.now()
      await sync.hydrateIfStale(15_000, 50)
      expect(Date.now() - t0).toBeLessThan(1000)
    })

    it('never throws when hydrate rejects', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      vi.spyOn(sync, 'hydrate').mockRejectedValue(new Error('network down'))
      await expect(sync.hydrateIfStale(15_000)).resolves.toBeUndefined()
    })

    it('backs off after a failed attempt instead of retrying on every read', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      const spy = vi.spyOn(sync, 'hydrate').mockRejectedValue(new Error('network down'))
      await sync.hydrateIfStale(15_000)
      await sync.hydrateIfStale(15_000)
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  // (h) ordering
  describe('(h) scoredQuery deterministic order', () => {
    it('identical scores come back newest first, then id ascending', () => {
      const t1 = '2026-11-03T10:00:00.000Z'
      const t2 = '2026-11-03T11:00:00.000Z'
      // Insert in an order that differs from the expected output.
      cache.upsertMemoryWithEmbedding(localMemory({ id: 'c', key: 'old', value: 'rule x', updatedAt: t1 }), [1, 0], false)
      cache.upsertMemoryWithEmbedding(localMemory({ id: 'b', key: 'new-b', value: 'rule x', updatedAt: t2 }), [1, 0], false)
      cache.upsertMemoryWithEmbedding(localMemory({ id: 'a', key: 'new-a', value: 'rule x', updatedAt: t2 }), [1, 0], false)
      const keys = cache.scoredQuery(PROJECT, 'rule x', [1, 0]).map((r) => r.memory.key)
      expect(keys).toEqual(['new-a', 'new-b', 'old'])
      const textOnly = cache.scoredQuery(PROJECT, 'rule x', null).map((r) => r.memory.key)
      expect(textOnly).toEqual(['new-a', 'new-b', 'old'])
    })

    it('getLiveMissingEmbedding: live rows without embeddings, newest first, then id', () => {
      const t1 = '2026-11-03T10:00:00.000Z'
      const t2 = '2026-11-03T11:00:00.000Z'
      cache.upsertMemory(localMemory({ id: 'z', key: 'older', updatedAt: t1 }), false)
      cache.upsertMemory(localMemory({ id: 'b', key: 'newer-b', updatedAt: t2 }), false)
      cache.upsertMemory(localMemory({ id: 'a', key: 'newer-a', updatedAt: t2 }), false)
      cache.upsertMemory(localMemory({ key: 'pending', status: 'pending', updatedAt: t2 }), false)
      cache.upsertMemoryWithEmbedding(localMemory({ key: 'embedded', updatedAt: t2 }), [1], false)
      expect(cache.getLiveMissingEmbedding(PROJECT, 10).map((m) => m.key)).toEqual(['newer-a', 'newer-b', 'older'])
      expect(cache.getLiveMissingEmbedding(PROJECT, 1).map((m) => m.key)).toEqual(['newer-a'])
    })
  })

  // (i) 0.5.7 review fixes: W1 (skew), W2 (reconcile races), W3 (hangs), S2, Q2
  describe('(j) /code-review round 2', () => {
    const T0 = Date.parse('2026-11-05T12:00:00.000Z')
    function useClock(ms: number) {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(T0 + ms))
    }
    it('full pull with db-max-rows below PAGE_SIZE lists every row and deletes nothing', async () => {
      const fake = makeFake()
      for (let i = 0; i < 1200; i++) fake.addRow({ key: `k-${String(i).padStart(4, '0')}` })
      const sync = makeSync(fake)
      await sync.hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(1200)

      // A 500-row server cap plus a legacy watermark forces the full pull.
      fake.setPgCap(500)
      // A teammate edits a row that sorts past the first capped page.
      const late = [...fake.rows].sort((x, y) => (x.id < y.id ? -1 : 1))[1100]
      late.value = 'edited by a teammate'
      late.updated_at = serverNow()
      cache.setLastSyncedAt(PROJECT, '2026-01-01T00:00:00.000Z', 1200)
      await sync.hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(1200)
      expect(cache.getByKey(PROJECT, late.key)?.value).toBe('edited by a teammate')
    })

    it('full pull deletes nothing when the exact count disagrees with the listing', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()
      // "b" is missing from the listing, but the exact count says 2 rows
      // (a truncated listing): nothing may be deleted on that evidence.
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'b'), 1)
      const origFrom = fake.supabase.from
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(fake.supabase as any).from = (table: string) => {
        const t = origFrom(table)
        return {
          ...t,
          select: (cols: string, o?: { count?: string; head?: boolean }) =>
            o?.head
              ? { eq: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 2 }).then(r) }) }
              : t.select(cols, o),
        }
      }
      cache.setLastSyncedAt(PROJECT, '2026-01-01T00:00:00.000Z', 2)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).not.toBeNull()
      // With an agreeing count the same listing deletes it.
      ;(fake.supabase as any).from = origFrom
      cache.setLastSyncedAt(PROJECT, '2026-01-01T00:00:00.000Z', 2)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).toBeNull()
    })

    it('a failed push is not retried by every read within the backoff', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      useClock(0)
      cache.upsertMemory(localMemory({ key: 'stuck', value: 'never lands' }), true)
      fake.setFailUpserts(true)
      const upserts = () => fake.calls.filter((c) => c.op === 'memories.upsert').length

      await sync.hydrate() // first attempt fails
      expect(upserts()).toBe(1)
      useClock(30_000)
      await sync.hydrate()
      expect(upserts()).toBe(1) // inside the 60s backoff: no doomed retry
      useClock(61_000)
      await sync.hydrate()
      expect(upserts()).toBe(2)
    })

    it('hydrate({ skipFlush: true }) does not push', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      cache.upsertMemory(localMemory({ key: 'dirty' }), true)
      await sync.hydrate({ skipFlush: true })
      expect(fake.calls.filter((c) => c.op === 'memories.upsert')).toHaveLength(0)
    })
  })

  describe('(i) review W1-W3, S2, Q2', () => {
    const T = Date.parse(SERVER_EPOCH)
    const at = (ms: number) => new Date(T + ms).toISOString().replace('Z', '000+00:00')
    const MIN = 60_000

    function useClock(ms: number) {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(T + ms))
    }

    function failPushes(fake: ReturnType<typeof makeFake>) {
      const origFrom = fake.supabase.from
      fake.supabase.from = vi.fn((table: string) => {
        const t = origFrom(table)
        return { ...t, upsert: () => Promise.resolve({ error: { message: 'permission denied' } }) }
      }) as unknown as typeof origFrom
    }

    it('W1 clamp: a teammate clock a day fast cannot hide a later archive', async () => {
      useClock(0)
      const fake = makeFake()
      fake.addRow({ key: 'base' })
      fake.addRow({ key: 'fast', updated_at: at(24 * 60 * MIN) })
      const sync = makeSync(fake)
      await sync.hydrate()
      expect(Date.parse(cache.getRemoteWatermark(PROJECT)!)).toBeLessThanOrEqual(Date.now() + 1000)

      // 15 min later (server time) a teammate archives "base": now() is far
      // below the fast row's updated_at, and the row count does not change.
      useClock(15 * MIN)
      const row = fake.rows.find((r) => r.key === 'base')!
      row.status = 'archived'
      row.updated_at = at(15 * MIN)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'base')?.status).toBe('archived')
    })

    it('W1 window: an edit whose now() trails the watermark (commit gap) is still pulled', async () => {
      useClock(0)
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()

      // A transaction that started 30s before the watermark commits after our
      // pull: its updated_at (now() = transaction start) is below the watermark.
      useClock(1 * MIN)
      const row = fake.rows.find((r) => r.key === 'a')!
      row.status = 'archived'
      row.updated_at = at(-30_000)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'a')?.status).toBe('archived')
    })

    it('W1 window goes cold: once listed past the margin, a quiet project is two head counts', async () => {
      useClock(0)
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      useClock(1 * MIN)
      fake.calls.length = 0
      await sync.hydrate() // hot: head count + window listing
      expect(fake.calls.filter((c) => c.op === 'memories.select').length).toBeGreaterThan(1)
      useClock(11 * MIN)
      await sync.hydrate() // still hot until a listing starts past the margin
      useClock(12 * MIN)
      fake.calls.length = 0
      expect(await sync.hydrate()).toBe(0)
      expect(fake.calls).toHaveLength(2)
    })

    it('W1 window: rows already cached at the same revision are not re-applied', async () => {
      useClock(0)
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      useClock(1 * MIN)
      expect(await sync.hydrate()).toBe(0)
    })

    it('W2a: a row pushed and marked synced during the listing await is not deleted', async () => {
      useClock(0)
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()

      // Teammate forgets "b" (count mismatch -> reconcile listing). While the
      // listing is in flight, this process remembers "c", pushes it and marks
      // it synced: the listing cannot contain it.
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'b'), 1)
      const mem = localMemory({ key: 'c', value: 'fresh' })
      fake.setAfterSelect((_n, filters) => {
        const isFullListing = filters.every(([k, c]) => k === 'eq' || (k === 'gt' && c === 'id'))
        if (!isFullListing || cache.getByKey(PROJECT, 'c')) return
        cache.upsertMemory(mem, true)
        fake.addRow({ key: 'c', value: 'fresh' })
        vi.setSystemTime(new Date(Date.now() + 1000))
        cache.markSynced([mem.id])
      })
      useClock(1 * MIN)
      await sync.hydrate()
      // The listing pages until an empty page, so it may pick up "c" and
      // disagree with the count; that round defers deletions. Either way "c"
      // is never deleted, and "b" is gone by the next round at the latest.
      expect(cache.getByKey(PROJECT, 'c')?.value).toBe('fresh')
      fake.setAfterSelect(null)
      useClock(2 * MIN)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).toBeNull()
      expect(cache.getByKey(PROJECT, 'c')?.value).toBe('fresh')
    })

    it('W2b: keyset paging: a row deleted from page 1 mid-listing does not skip a live row', async () => {
      const fake = makeFake()
      for (let i = 0; i < 1500; i++) fake.addRow({ key: `k-${String(i).padStart(4, '0')}` })
      const sync = makeSync(fake)
      await sync.hydrate()
      expect(cache.getMemoryCount(PROJECT)).toBe(1500)

      // Force the full pull (legacy watermark), and have a teammate delete the
      // lowest-id row right after page 1 is served.
      cache.setLastSyncedAt(PROJECT, '2026-01-01T00:00:00.000Z', 1500)
      fake.setAfterSelect((n) => {
        if (n !== 1) return
        const lowest = [...fake.rows].sort((x, y) => (x.id < y.id ? -1 : 1))[0]
        fake.rows.splice(fake.rows.indexOf(lowest), 1)
      })
      await sync.hydrate()
      fake.setAfterSelect(null)
      const missing = fake.rows.filter((r) => cache.getByKey(PROJECT, r.key) === null)
      expect(missing.map((r) => r.key)).toEqual([])
    })

    it('W3: a hung Supabase request aborts, so the single-flight hydrate is released', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      sync.queryTimeoutMs = 50
      fake.setHang(true)
      const t0 = Date.now()
      expect(await sync.hydrate()).toBe(0)
      expect(Date.now() - t0).toBeLessThan(1000)
      fake.setHang(false)
      expect(await sync.hydrate()).toBe(1)
    }, 3000)

    it('W3: a hung embedding update or delete times out instead of pinning the queue hydrate waits on', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      sync.queryTimeoutMs = 50
      fake.setHang(true)
      const t0 = Date.now()
      expect(await sync.remoteUpdateEmbedding(PROJECT, 'a', [0.1, 0.2])).toBe(false)
      expect(await sync.remoteDelete(PROJECT, 'a')).toBe(false)
      expect(Date.now() - t0).toBeLessThan(1000)
      fake.setHang(false)
      expect(await sync.hydrate()).toBe(1)
    }, 3000)

    it('W3: a hung stale run costs one timeout in total, not one per read', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      vi.spyOn(sync, 'hydrate').mockImplementation(() => new Promise(() => {}))
      const t0 = Date.now()
      await sync.hydrateIfStale(15_000, 300)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(280)
      const t1 = Date.now()
      await sync.hydrateIfStale(15_000, 300)
      await sync.hydrateIfStale(15_000, 300)
      expect(Date.now() - t1).toBeLessThan(150)
    })

    it('S2: an unpushable dirty row does not force a listing on every freshen', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      const sync = makeSync(fake)
      await sync.hydrate()
      failPushes(fake) // read-only member
      cache.upsertMemory(localMemory({ key: 'mine', value: 'local only' }), true)
      await sync.hydrate()
      fake.calls.length = 0
      expect(await sync.hydrate()).toBe(0)
      expect(fake.calls).toHaveLength(2)
      expect(fake.calls.every((c) => c.op === 'memories.select')).toBe(true)
      expect(cache.getByKey(PROJECT, 'mine')?.value).toBe('local only')
    })

    it('S2: with a dirty row excluded, a teammate forget is still reconciled', async () => {
      const fake = makeFake()
      fake.addRow({ key: 'a' })
      fake.addRow({ key: 'b' })
      const sync = makeSync(fake)
      await sync.hydrate()
      failPushes(fake)
      cache.upsertMemory({ ...cache.getByKey(PROJECT, 'a')!, value: 'my unpushed edit' }, true)
      cache.upsertMemory(localMemory({ key: 'mine' }), true)
      fake.rows.splice(fake.rows.findIndex((r) => r.key === 'b'), 1)
      await sync.hydrate()
      expect(cache.getByKey(PROJECT, 'b')).toBeNull()
      expect(cache.getByKey(PROJECT, 'a')?.value).toBe('my unpushed edit')
      expect(cache.getByKey(PROJECT, 'mine')).not.toBeNull()
    })

    it('S2: pgInList quotes and escapes keys', () => {
      expect(pgInList(['a', 'b,c', 'q"x', 'back\\slash'])).toBe('("a","b,c","q\\"x","back\\\\slash")')
    })

    it('Q2: an edit made while the flush upsert is in flight stays dirty', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      const mem = localMemory({ key: 'q', value: 'v1', updatedAt: '2026-06-01T10:00:00.000Z' })
      cache.upsertMemory(mem, true)
      const origFrom = fake.supabase.from
      fake.supabase.from = vi.fn((table: string) => {
        const t = origFrom(table)
        return {
          ...t,
          upsert: (input: Record<string, unknown>[]) => {
            // The user edits "q" while v1 is on the wire.
            cache.upsertMemory({ ...mem, value: 'v2', updatedAt: '2026-06-01T10:00:01.000Z' }, true)
            return t.upsert(input)
          },
        }
      }) as unknown as typeof origFrom
      await sync.flush()
      expect(cache.getDirty().map((m) => m.value)).toEqual(['v2'])
      fake.supabase.from = origFrom
      await sync.flush()
      expect(cache.getDirty()).toHaveLength(0)
      expect(fake.rows.find((r) => r.key === 'q')?.value).toBe('v2')
    })

    it('Q2: a status-only change during the flush (no updated_at bump) stays dirty', async () => {
      const fake = makeFake()
      const sync = makeSync(fake)
      const mem = localMemory({ key: 'q', value: 'v1' })
      cache.upsertMemory(mem, true)
      const origFrom = fake.supabase.from
      fake.supabase.from = vi.fn((table: string) => {
        const t = origFrom(table)
        return {
          ...t,
          upsert: (input: Record<string, unknown>[]) => {
            cache.updateMemoryStatus(mem.id, 'archived')
            return t.upsert(input)
          },
        }
      }) as unknown as typeof origFrom
      await sync.flush()
      expect(cache.getDirty().map((m) => m.status)).toEqual(['archived'])
    })
  })
})
