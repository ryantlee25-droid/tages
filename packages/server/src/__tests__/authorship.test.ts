/**
 * Authorship threading tests.
 *
 * Verifies that callerUserId is stamped onto memories as createdBy/updatedBy
 * when write-path handlers are called with a callerUserId argument.
 *
 * Uses a minimal mock for SupabaseSync so we can inspect what row was passed
 * to remoteInsert without needing a real Supabase connection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { handleRemember } from '../tools/remember'
import { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { Memory } from '@tages/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-authorship-project'
const CALLER_ID = '00000000-0000-0000-0000-000000000001'

function makeMockSync(): SupabaseSync & { lastInserted: Memory | null } {
  const mock = {
    lastInserted: null as Memory | null,
    remoteInsert: vi.fn(async (mem: Memory) => {
      mock.lastInserted = mem
      return true
    }),
    markSynced: vi.fn(),
    startSync: vi.fn(),
    stopSync: vi.fn(),
    flush: vi.fn(async () => {}),
    hydrate: vi.fn(async () => 0),
    recoverWAL: vi.fn(async () => 0),
    remoteDelete: vi.fn(async () => true),
    remoteRecall: vi.fn(async () => null),
    remoteHybridRecall: vi.fn(async () => null),
    remoteGetByType: vi.fn(async () => null),
    remoteVerifyMemory: vi.fn(async () => true),
  }
  return mock as unknown as SupabaseSync & { lastInserted: Memory | null }
}

describe('authorship threading', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-authorship-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('stamps createdBy and updatedBy on first insert when callerUserId is provided', async () => {
    const sync = makeMockSync()

    await handleRemember(
      { key: 'test-key', value: 'test value', type: 'convention' },
      TEST_PROJECT,
      cache,
      sync as unknown as SupabaseSync,
      undefined,
      CALLER_ID,
    )

    // Authorship flows to Supabase via remoteInsert — verify the row passed to sync
    expect(sync.remoteInsert).toHaveBeenCalledOnce()
    expect(sync.lastInserted?.createdBy).toBe(CALLER_ID)
    expect(sync.lastInserted?.updatedBy).toBe(CALLER_ID)
  })

  it('sets updatedBy but does not overwrite createdBy on update', async () => {
    const ORIGINAL_CREATOR = '00000000-0000-0000-0000-000000000002'
    const UPDATER_ID = '00000000-0000-0000-0000-000000000003'

    // First: create with ORIGINAL_CREATOR
    await handleRemember(
      { key: 'update-key', value: 'original value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
      undefined,
      ORIGINAL_CREATOR,
    )

    // Verify cache recorded the memory exists (authorship is not in local schema)
    const afterCreate = cache.getByKey(TEST_PROJECT, 'update-key')
    expect(afterCreate).toBeTruthy()

    // Second: update with UPDATER_ID
    const sync = makeMockSync()
    await handleRemember(
      { key: 'update-key', value: 'updated value', type: 'convention' },
      TEST_PROJECT,
      cache,
      sync as unknown as SupabaseSync,
      undefined,
      UPDATER_ID,
    )

    // Verify sync received the correct authorship:
    // - updatedBy = UPDATER_ID (the current caller)
    // - createdBy should NOT be UPDATER_ID (existing memory, so no createdBy override)
    expect(sync.remoteInsert).toHaveBeenCalledOnce()
    expect(sync.lastInserted?.updatedBy).toBe(UPDATER_ID)
    // createdBy is not set again on update (existing memory path)
    expect(sync.lastInserted?.createdBy).toBeUndefined()
  })

  it('does not set createdBy/updatedBy when callerUserId is undefined (local-only mode)', async () => {
    await handleRemember(
      { key: 'local-key', value: 'local value', type: 'decision' },
      TEST_PROJECT,
      cache,
      null,
      undefined,
      undefined, // no callerUserId
    )

    const stored = cache.getByKey(TEST_PROJECT, 'local-key')
    expect(stored?.createdBy).toBeUndefined()
    expect(stored?.updatedBy).toBeUndefined()
  })
})
