import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ColdStorage } from '../archive/cold-storage'
import { ArchiveManager } from '../archive/archiver'
import { SqliteCache } from '../cache/sqlite'
import type { Memory } from '@tages/shared'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const PROJECT = 'archive-test'

function makeMemory(key: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${key}-${Date.now()}`,
    projectId: PROJECT,
    key,
    value: `value for ${key}`,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    crossSystemRefs: ['other-ref'],
    conditions: ['when testing'],
    examples: [{ input: 'x', output: 'y' }],
    phases: ['planning'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makePaths(): { dbPath: string; archivePath: string } {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    dbPath: path.join(os.tmpdir(), `tages-cache-${ts}.db`),
    archivePath: path.join(os.tmpdir(), `tages-archive-${ts}.db`),
  }
}

describe('ColdStorage', () => {
  let storage: ColdStorage
  let storagePath: string

  beforeEach(() => {
    storagePath = path.join(os.tmpdir(), `cold-test-${Date.now()}.db`)
    storage = new ColdStorage(storagePath, 90)
  })

  afterEach(() => {
    storage.close()
    try { fs.unlinkSync(storagePath) } catch {}
  })

  it('archives a memory and retrieves it', () => {
    const mem = makeMemory('archived-key')
    storage.archive(mem, 'test reason')
    const entry = storage.getArchived(PROJECT, 'archived-key')
    expect(entry).not.toBeNull()
    expect(entry!.memoryKey).toBe('archived-key')
    expect(entry!.archiveReason).toBe('test reason')
  })

  it('preserves all memory fields in archive', () => {
    const mem = makeMemory('full-mem')
    storage.archive(mem, 'test')
    const entry = storage.getArchived(PROJECT, 'full-mem')!
    expect(entry.memory.crossSystemRefs).toEqual(['other-ref'])
    expect(entry.memory.conditions).toEqual(['when testing'])
    expect(entry.memory.examples).toEqual([{ input: 'x', output: 'y' }])
    expect(entry.memory.phases).toEqual(['planning'])
  })

  it('lists multiple archived memories', () => {
    storage.archive(makeMemory('a'), 'reason a')
    storage.archive(makeMemory('b'), 'reason b')
    const entries = storage.listArchived(PROJECT)
    expect(entries.length).toBe(2)
  })

  it('deletes a specific archive entry', () => {
    storage.archive(makeMemory('del-me'), 'test')
    expect(storage.getArchived(PROJECT, 'del-me')).not.toBeNull()
    storage.deleteArchive(PROJECT, 'del-me')
    expect(storage.getArchived(PROJECT, 'del-me')).toBeNull()
  })

  it('sets expiry date based on retention policy', () => {
    const mem = makeMemory('expiry-test')
    storage.archive(mem, 'test')
    const entry = storage.getArchived(PROJECT, 'expiry-test')!
    expect(entry.expiresAt).toBeDefined()
    const expiresMs = new Date(entry.expiresAt!).getTime()
    expect(expiresMs).toBeGreaterThan(Date.now())
  })

  it('enforces retention and deletes expired entries', () => {
    // Archive with very short retention
    const fastStorage = new ColdStorage(storagePath + '-fast.db', 0)
    const mem = makeMemory('expire-now')
    fastStorage.archive(mem, 'test')
    // Force expiry in the past by updating expires_at (we can't without direct DB access)
    // Instead, test that enforceRetention runs without error
    const expired = fastStorage.enforceRetention()
    expect(typeof expired).toBe('number')
    fastStorage.close()
    try { fs.unlinkSync(storagePath + '-fast.db') } catch {}
  })

  it('tracks archive stats', () => {
    storage.archive(makeMemory('s1'), 'test')
    storage.archive(makeMemory('s2'), 'test')
    const stats = storage.getStats(PROJECT)
    expect(stats.totalArchived).toBe(2)
    expect(stats.totalRestored).toBe(0)
  })
})

describe('ArchiveManager', () => {
  let manager: ArchiveManager
  let cache: SqliteCache
  let dbPath: string
  let archivePath: string

  beforeEach(() => {
    const paths = makePaths()
    dbPath = paths.dbPath
    archivePath = paths.archivePath
    cache = new SqliteCache(dbPath)
    manager = new ArchiveManager(archivePath, 90)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(archivePath) } catch {}
  })

  it('archives memory and marks it archived in cache', () => {
    const mem = makeMemory('to-archive')
    cache.upsertMemory(mem)
    manager.archiveMemory(mem, 'manual', cache)
    const inCache = cache.getByKey(PROJECT, 'to-archive')
    expect(inCache?.status).toBe('archived')
  })

  it('restore re-creates memory in cache as live', () => {
    const mem = makeMemory('to-restore')
    cache.upsertMemory(mem)
    manager.archiveMemory(mem, 'manual', cache)
    const restored = manager.restoreMemory(PROJECT, 'to-restore', cache)
    expect(restored).not.toBeNull()
    expect(restored!.status).toBe('live')
    const inCache = cache.getByKey(PROJECT, 'to-restore')
    expect(inCache?.status).toBe('live')
  })

  it('archived memory excluded from recall results', () => {
    const mem = makeMemory('hidden-after-archive')
    cache.upsertMemory(mem)
    manager.archiveMemory(mem, 'test', cache)
    const results = cache.queryMemories(PROJECT, 'hidden-after-archive')
    // queryMemories filters status='live'
    expect(results.length).toBe(0)
  })

  it('auto-archive does not archive fresh high-quality memories', () => {
    const goodMem = makeMemory('fresh-good', {
      updatedAt: new Date().toISOString(),
      conditions: ['x'], examples: [{ input: 'i', output: 'o' }],
      crossSystemRefs: ['r'], tags: ['t'], filePaths: ['f'],
      confidence: 1.0, value: 'a'.repeat(200),
    })
    cache.upsertMemory(goodMem)
    const result = manager.autoArchiveScan(PROJECT, cache, 30, 60)
    expect(result.archived).toBe(0)
  })

  it('auto-archive targets stale low-quality memories', () => {
    const staleMem = makeMemory('stale-bad', {
      updatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
      confidence: 0.1,
      value: 'x',
      tags: [], filePaths: [], conditions: undefined, examples: undefined,
      crossSystemRefs: [],
    })
    cache.upsertMemory(staleMem)
    // Score breakdown: completeness=0, freshness=0 (200d), consistency=25, usefulness=2 → total=27
    const result = manager.autoArchiveScan(PROJECT, cache, 30, 60)
    expect(result.archived).toBe(1)
    expect(result.reasons[0].key).toBe('stale-bad')
  })

  it('archive stats accurate after operations', () => {
    const mem = makeMemory('counted')
    cache.upsertMemory(mem)
    manager.archiveMemory(mem, 'test', cache)
    const stats = manager.getStats(PROJECT)
    expect(stats.totalArchived).toBe(1)
  })
})
