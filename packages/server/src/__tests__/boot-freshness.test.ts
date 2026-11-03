/**
 * 0.5.7 Task 1b (bug 3): boot always hydrates, off the critical path; the
 * read tools refresh a stale cache before reading.
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { startBootFreshness, createReadFreshener, READ_FRESHNESS_MS } from '../hydration'

const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf-8')

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('startBootFreshness', () => {
  it('calls hydrate() even when the cache was synced 5s ago', async () => {
    const hydrate = vi.fn(async () => 0)
    const cache = { getLastSyncedAt: () => new Date(Date.now() - 5_000).toISOString() } as unknown as SqliteCache
    const { hydrated } = startBootFreshness({ hydrate } as unknown as SupabaseSync, cache, 'p', undefined, {
      backfill: vi.fn(async () => 0),
    })
    await hydrated
    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it('returns before the hydrate settles (never blocks the handshake)', async () => {
    const d = deferred<number>()
    const backfill = vi.fn(async () => 0)
    const started = startBootFreshness({ hydrate: () => d.promise } as unknown as SupabaseSync, {} as SqliteCache, 'p', undefined, { backfill })
    let settled = false
    void started.hydrated.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(backfill).not.toHaveBeenCalled()
    d.resolve(3)
    await started.backfill
    expect(settled).toBe(true)
  })

  it('runs the backfill after the hydrate, with the project, cache and sync', async () => {
    const order: string[] = []
    const sync = { hydrate: vi.fn(async () => { order.push('hydrate'); return 1 }) } as unknown as SupabaseSync
    const cache = {} as SqliteCache
    const client = { tag: 'client' } as never
    const backfill = vi.fn(async () => { order.push('backfill'); return 4 })
    const { backfill: done } = startBootFreshness(sync, cache, 'proj', client, { backfill })
    expect(await done).toBe(4)
    expect(order).toEqual(['hydrate', 'backfill'])
    expect(backfill).toHaveBeenCalledWith('proj', cache, sync, client)
  })

  it('a failing hydrate or backfill never rejects', async () => {
    const sync = { hydrate: vi.fn(async () => { throw new Error('offline') }) } as unknown as SupabaseSync
    const { hydrated, backfill } = startBootFreshness(sync, {} as SqliteCache, 'p', undefined, {
      backfill: vi.fn(async () => { throw new Error('boom') }),
    })
    await expect(hydrated).resolves.toBeUndefined()
    await expect(backfill).resolves.toBe(0)
  })
})

describe('createReadFreshener', () => {
  it('calls hydrateIfStale(15000) on every read', async () => {
    const hydrateIfStale = vi.fn(async () => {})
    const freshen = createReadFreshener({ hydrateIfStale }, Promise.resolve())
    await freshen()
    await freshen()
    expect(READ_FRESHNESS_MS).toBe(15_000)
    expect(hydrateIfStale).toHaveBeenCalledTimes(2)
    expect(hydrateIfStale).toHaveBeenCalledWith(15_000)
  })

  it('the first read waits for the in-flight boot hydrate', async () => {
    const d = deferred<void>()
    const order: string[] = []
    const freshen = createReadFreshener({ hydrateIfStale: async () => { order.push('stale-check') } }, d.promise, { bootWaitMs: 5_000 })
    const read = freshen().then(() => order.push('read'))
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual([])
    order.push('boot-done')
    d.resolve()
    await read
    expect(order).toEqual(['boot-done', 'stale-check', 'read'])
  })

  it('the boot wait is capped (fail-open to the cache)', async () => {
    const hang = new Promise<void>(() => {})
    const hydrateIfStale = vi.fn(async () => {})
    const freshen = createReadFreshener({ hydrateIfStale }, hang, { bootWaitMs: 20 })
    const t0 = Date.now()
    await freshen()
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(hydrateIfStale).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without sync, and never throws', async () => {
    await expect(createReadFreshener(null, null)()).resolves.toBeUndefined()
    const freshen = createReadFreshener({ hydrateIfStale: async () => { throw new Error('x') } }, null)
    await expect(freshen()).resolves.toBeUndefined()
  })
})

describe('index.ts wiring', () => {
  function toolBlock(name: string): string {
    const start = INDEX_SRC.indexOf(`'${name}',`)
    expect(start).toBeGreaterThan(-1)
    const next = INDEX_SRC.indexOf('server.tool(', start)
    return INDEX_SRC.slice(start, next === -1 ? undefined : next)
  }

  it.each([
    ['recall', 'handleRecall('],
    ['conventions', 'handleConventions('],
    ['project_brief', 'handleBrief('],
  ])('%s freshens the cache before reading', (tool, handler) => {
    const block = toolBlock(tool)
    const f = block.indexOf('await freshen()')
    expect(f).toBeGreaterThan(-1)
    expect(f).toBeLessThan(block.indexOf(handler))
  })

  it('boot no longer skips hydration on a recent sync, and does not await it', () => {
    expect(INDEX_SRC).not.toMatch(/shouldHydrate\(/)
    expect(INDEX_SRC).not.toMatch(/await sync\.hydrate\(\)/)
    expect(INDEX_SRC).toMatch(/startBootFreshness\(sync, cache, projectId/)
  })

  it('archive_memory passes sync so the retraction is pushed immediately', () => {
    expect(INDEX_SRC).toMatch(/handleArchive\(args, projectId, cache, sync\)/)
  })
})
