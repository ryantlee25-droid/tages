/**
 * Round-trip coverage for the referencedDate / relativeDate temporal-anchor
 * columns (migration 0060) through BOTH persistence layers. These guard against
 * a field-mapping typo (camelCase <-> snake_case) silently dropping the two
 * dates on write or read, which would make the whole temporal-anchoring feature
 * a no-op even though extraction works.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import { memoryToDbRow, dbRowToMemory } from '../sync/supabase-sync'

const REFERENCED = new Date('2026-07-01T00:00:00.000Z').toISOString()
const RELATIVE = new Date('2026-07-05T12:00:00.000Z').toISOString()

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId: 'test-project-id',
    key: 'temporal-key',
    value: 'shipped auth on 2026-07-01, resolved 3 days ago',
    type: 'decision',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    referencedDate: REFERENCED,
    relativeDate: RELATIVE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('SqliteCache — referencedDate/relativeDate round-trip', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-temporal-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('persists and reads back both temporal anchors', () => {
    const mem = makeMemory({ key: 'roundtrip-key' })
    cache.upsertMemory(mem)
    const read = cache.getByKey('test-project-id', 'roundtrip-key')
    expect(read).not.toBeNull()
    expect(read!.referencedDate).toBe(REFERENCED)
    expect(read!.relativeDate).toBe(RELATIVE)
  })

  it('reads back undefined anchors for a memory written without dates', () => {
    const mem = makeMemory({ key: 'no-dates', referencedDate: undefined, relativeDate: undefined })
    cache.upsertMemory(mem)
    const read = cache.getByKey('test-project-id', 'no-dates')
    expect(read).not.toBeNull()
    expect(read!.referencedDate).toBeUndefined()
    expect(read!.relativeDate).toBeUndefined()
  })
})

describe('SupabaseSync row mapping — referencedDate/relativeDate round-trip', () => {
  it('maps camelCase anchors to snake_case columns and back', () => {
    const mem = makeMemory()
    const row = memoryToDbRow(mem)
    // Guards the exact column names the migration/RPC expect.
    expect(row.referenced_date).toBe(REFERENCED)
    expect(row.relative_date).toBe(RELATIVE)

    const back = dbRowToMemory(row)
    expect(back.referencedDate).toBe(REFERENCED)
    expect(back.relativeDate).toBe(RELATIVE)
  })

  it('maps absent anchors to null columns and back to undefined', () => {
    const mem = makeMemory({ referencedDate: undefined, relativeDate: undefined })
    const row = memoryToDbRow(mem)
    expect(row.referenced_date).toBeNull()
    expect(row.relative_date).toBeNull()

    const back = dbRowToMemory(row)
    expect(back.referencedDate).toBeUndefined()
    expect(back.relativeDate).toBeUndefined()
  })
})
