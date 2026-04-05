import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SyncWAL } from '../cache/sync-wal'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function makeTempPath() {
  return path.join(os.tmpdir(), `tages-wal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

describe('SyncWAL', () => {
  let wal: SyncWAL
  let dbPath: string

  beforeEach(() => {
    dbPath = makeTempPath()
    wal = new SyncWAL(dbPath)
  })

  afterEach(() => {
    wal.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('logs a pending operation and returns an id', () => {
    const id = wal.logPending('mem-1', 'proj-1', 'upsert', { key: 'test', value: 'hello' })
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('getIncomplete returns the logged operation', () => {
    wal.logPending('mem-1', 'proj-1', 'upsert', { key: 'test' })
    const incomplete = wal.getIncomplete()
    expect(incomplete.length).toBe(1)
    expect(incomplete[0].memoryId).toBe('mem-1')
    expect(incomplete[0].projectId).toBe('proj-1')
    expect(incomplete[0].operation).toBe('upsert')
  })

  it('markComplete removes entry from incomplete list', () => {
    const id = wal.logPending('mem-2', 'proj-1', 'upsert', { key: 'done' })
    expect(wal.getIncomplete().length).toBe(1)
    wal.markComplete(id)
    expect(wal.getIncomplete().length).toBe(0)
  })

  it('getIncomplete returns multiple incomplete operations', () => {
    wal.logPending('mem-1', 'proj-1', 'upsert', {})
    wal.logPending('mem-2', 'proj-1', 'upsert', {})
    wal.logPending('mem-3', 'proj-1', 'delete', 'some-key')
    const incomplete = wal.getIncomplete()
    expect(incomplete.length).toBe(3)
  })

  it('markCompleteByMemoryIds marks all matching entries complete', () => {
    wal.logPending('mem-1', 'proj-1', 'upsert', {})
    wal.logPending('mem-2', 'proj-1', 'upsert', {})
    wal.logPending('mem-3', 'proj-1', 'upsert', {})
    wal.markCompleteByMemoryIds(['mem-1', 'mem-2'])
    const incomplete = wal.getIncomplete()
    expect(incomplete.length).toBe(1)
    expect(incomplete[0].memoryId).toBe('mem-3')
  })

  it('recover incomplete: empty WAL returns empty array', () => {
    expect(wal.getIncomplete()).toEqual([])
  })

  it('persists across instances (crash recovery)', () => {
    wal.logPending('mem-crash', 'proj-1', 'upsert', { key: 'crashed' })
    wal.close()

    // Simulate a new startup — re-open the same WAL db
    const wal2 = new SyncWAL(dbPath)
    const incomplete = wal2.getIncomplete()
    expect(incomplete.length).toBe(1)
    expect(incomplete[0].memoryId).toBe('mem-crash')
    wal2.close()

    // Reopen for afterEach cleanup
    wal = new SyncWAL(dbPath)
  })

  it('idempotent: markComplete on already-complete entry is a no-op', () => {
    const id = wal.logPending('mem-idem', 'proj-1', 'upsert', {})
    wal.markComplete(id)
    wal.markComplete(id) // should not throw or double-count
    expect(wal.getIncomplete().length).toBe(0)
  })

  it('getPendingCount returns correct count', () => {
    expect(wal.getPendingCount()).toBe(0)
    wal.logPending('m1', 'p1', 'upsert', {})
    wal.logPending('m2', 'p1', 'upsert', {})
    expect(wal.getPendingCount()).toBe(2)
    const id1 = wal.logPending('m3', 'p1', 'upsert', {})
    wal.markComplete(id1)
    expect(wal.getPendingCount()).toBe(2)
  })
})
