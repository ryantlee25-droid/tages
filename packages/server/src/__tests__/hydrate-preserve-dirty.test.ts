import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * hydrateFromRemote applies cloud state over the local cache. The cloud winning
 * is the intent — except for rows that have not been pushed yet, which it must
 * not destroy.
 *
 * The failure this guards against is silent: `upsertMemory(mem, false)`
 * overwrites the value AND clears the dirty flag, so an unsynced local edit is
 * both reverted and removed from the retry queue. The user watches their
 * correction disappear with no error anywhere.
 */

const PROJECT = 'proj-1'

function makeMemory(over: Record<string, unknown> = {}) {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    projectId: PROJECT,
    key: 'k',
    value: 'v',
    type: 'convention' as const,
    source: 'manual' as const,
    status: 'live' as const,
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

describe('hydrateFromRemote — unsynced local work', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-hydrate-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(p)) fs.rmSync(p)
    }
  })

  it('applies the remote value over a clean local row', () => {
    cache.upsertMemory(makeMemory({ key: 'a', value: 'local' }) as never, false)
    cache.hydrateFromRemote([makeMemory({ key: 'a', value: 'remote' })] as never)
    expect(cache.getByKey(PROJECT, 'a')?.value).toBe('remote')
  })

  it('does NOT overwrite a row that is still dirty', () => {
    cache.upsertMemory(makeMemory({ key: 'a', value: 'local edit' }) as never, true)
    cache.hydrateFromRemote([makeMemory({ key: 'a', value: 'stale remote' })] as never)
    expect(cache.getByKey(PROJECT, 'a')?.value).toBe('local edit')
  })

  it('leaves the dirty row still dirty, so it is retried rather than dropped', () => {
    cache.upsertMemory(makeMemory({ key: 'a', value: 'local edit' }) as never, true)
    cache.hydrateFromRemote([makeMemory({ key: 'a', value: 'stale remote' })] as never)
    expect(cache.getDirty().map(m => m.key)).toContain('a')
  })

  it('protects only the dirty row, not its clean neighbours in the same batch', () => {
    cache.upsertMemory(makeMemory({ key: 'dirty', value: 'local edit' }) as never, true)
    cache.upsertMemory(makeMemory({ key: 'clean', value: 'local' }) as never, false)
    cache.hydrateFromRemote([
      makeMemory({ key: 'dirty', value: 'remote' }),
      makeMemory({ key: 'clean', value: 'remote' }),
    ] as never)
    expect(cache.getByKey(PROJECT, 'dirty')?.value).toBe('local edit')
    expect(cache.getByKey(PROJECT, 'clean')?.value).toBe('remote')
  })

  it('never touches a local-only row absent from the remote batch', () => {
    // "The cloud wins" must not mean "anything the cloud lacks is deleted".
    cache.upsertMemory(makeMemory({ key: 'local-only', value: 'mine' }) as never, true)
    cache.hydrateFromRemote([makeMemory({ key: 'other', value: 'remote' })] as never)
    expect(cache.getByKey(PROJECT, 'local-only')?.value).toBe('mine')
  })

  it('keys the guard per project, so a same-named key elsewhere is unaffected', () => {
    cache.upsertMemory(makeMemory({ key: 'shared', value: 'p1 local edit' }) as never, true)
    cache.upsertMemory(makeMemory({ key: 'shared', projectId: 'proj-2', value: 'p2 local' }) as never, false)
    cache.hydrateFromRemote([
      makeMemory({ key: 'shared', value: 'p1 remote' }),
      makeMemory({ key: 'shared', projectId: 'proj-2', value: 'p2 remote' }),
    ] as never)
    expect(cache.getByKey(PROJECT, 'shared')?.value).toBe('p1 local edit')
    expect(cache.getByKey('proj-2', 'shared')?.value).toBe('p2 remote')
  })

  it('preserveDirty:false restores the old clobbering behaviour for callers that want it', () => {
    cache.upsertMemory(makeMemory({ key: 'a', value: 'local edit' }) as never, true)
    cache.hydrateFromRemote([makeMemory({ key: 'a', value: 'remote' })] as never, { preserveDirty: false })
    expect(cache.getByKey(PROJECT, 'a')?.value).toBe('remote')
  })

  /**
   * The caller needs to know a row was withheld. Without this, SupabaseSync
   * advances `last_synced_at` past the skipped revision, which then falls
   * outside every future `updated_at > lastSynced` window — so that key can
   * never be refreshed from the cloud again, and the "cache is current" fast
   * path reports it up to date forever.
   */
  it('reports what it skipped, so the caller can hold its sync watermark', () => {
    cache.upsertMemory(makeMemory({ key: 'dirty', value: 'local edit' }) as never, true)
    cache.upsertMemory(makeMemory({ key: 'clean', value: 'local' }) as never, false)
    const result = cache.hydrateFromRemote([
      makeMemory({ key: 'dirty', value: 'remote', updatedAt: '2026-08-17T10:00:00.000Z' }),
      makeMemory({ key: 'clean', value: 'remote' }),
    ] as never)
    expect(result.applied).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ key: 'dirty', projectId: PROJECT, updatedAt: '2026-08-17T10:00:00.000Z' })
  })

  it('reports an empty skip list when everything applied', () => {
    cache.upsertMemory(makeMemory({ key: 'a', value: 'local' }) as never, false)
    const result = cache.hydrateFromRemote([makeMemory({ key: 'a', value: 'remote' })] as never)
    expect(result.applied).toBe(1)
    expect(result.skipped).toEqual([])
  })

  it('composite keys survive a key containing the characters a delimiter would use', () => {
    // Keys are user-supplied. A naive "projectId + separator + key" scheme can
    // be spoofed or collided by a key containing the separator; JSON escaping
    // cannot. (The original separator here was a raw NUL byte, which also made
    // the source file test as binary and broke code search entirely.)
    const nasty = 'weird","key|with:control'
    cache.upsertMemory(makeMemory({ key: nasty, value: 'local edit' }) as never, true)
    cache.hydrateFromRemote([makeMemory({ key: nasty, value: 'remote' })] as never)
    expect(cache.getByKey(PROJECT, nasty)?.value).toBe('local edit')
  })
})
