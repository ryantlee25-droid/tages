/**
 * The MCP `remember` tool must not report success when the remote write failed.
 *
 * `handleRemember` used to `await sync.remoteInsert(memory)` and DISCARD the
 * result, then return `Stored memory: "..."` regardless. Agents write through
 * this path (not the CLI), so a failed cloud write looked identical to a
 * durable one: the memory lived only in the developer's local SQLite with
 * dirty=1, invisible to every teammate, with nothing surfaced anywhere the
 * developer would look.
 *
 * Failure detection here is the BOOLEAN RETURN of `remoteInsert`, not a
 * try/catch. `SupabaseSync.remoteInsert` catches the Supabase error, logs
 * `[tages] Remote insert failed: <reason>`, and `return false`
 * (packages/server/src/sync/supabase-sync.ts) — it never throws for a rejected
 * write, so a try/catch alone would catch nothing. That is the same
 * swallow-the-error property the CLI fix found in `flush()`, except
 * `remoteInsert` at least surfaces a boolean, so the boolean is authoritative
 * and the reason is recovered from the teed log line.
 *
 * These tests use a real SqliteCache (so the dirty flag is real) and a mocked
 * SupabaseSync, and mock `../embeddings` so no Ollama/OpenAI call is made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { Memory } from '@tages/shared'

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(async () => null),
  generateChunkEmbeddings: vi.fn(async () => null),
}))

const TEST_PROJECT = 'test-remember-sync-failure-project'

/** rowToMemory does not surface the raw dirty column, so read it directly. */
function readDirty(dbPath: string, key: string): number | undefined {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db
      .prepare('SELECT dirty FROM memories WHERE project_id = ? AND key = ?')
      .get(TEST_PROJECT, key) as { dirty: number } | undefined
    return row?.dirty
  } finally {
    db.close()
  }
}

/**
 * Mock SupabaseSync whose remoteInsert mimics the REAL failure contract:
 * log `[tages] Remote insert failed: <message>` to console.error, then return
 * false. It must not throw — reproducing the exact silent-failure shape.
 */
function makeMockSync(opts: {
  insertOk: boolean
  failureMessage?: string
  logFailure?: boolean
  throwOnInsert?: Error
}): SupabaseSync {
  const mock = {
    inserted: [] as Memory[],
    remoteInsert: vi.fn(async (mem: Memory) => {
      if (opts.throwOnInsert) throw opts.throwOnInsert
      mock.inserted.push(mem)
      if (opts.insertOk) return true
      if (opts.logFailure !== false) {
        console.error('[tages] Remote insert failed:', opts.failureMessage ?? 'network unreachable')
      }
      return false
    }),
    remoteUpdateEmbedding: vi.fn(async () => true),
    remoteUpsertChunks: vi.fn(async () => true),
    remoteDelete: vi.fn(async () => true),
    remoteCountMemories: vi.fn(async () => 0),
    startSync: vi.fn(),
    stopSync: vi.fn(),
    flush: vi.fn(async () => {}),
    hydrate: vi.fn(async () => 0),
    recoverWAL: vi.fn(async () => 0),
    markSynced: vi.fn(),
  }
  return mock as unknown as SupabaseSync
}

/** The MCP response shape contract — must be identical on every path. */
function expectMcpShape(result: unknown): string {
  expect(Object.keys(result as object)).toEqual(['content'])
  const r = result as { content: Array<{ type: string; text: string }> }
  expect(Array.isArray(r.content)).toBe(true)
  expect(r.content).toHaveLength(1)
  expect(Object.keys(r.content[0])).toEqual(['type', 'text'])
  expect(r.content[0].type).toBe('text')
  expect(typeof r.content[0].text).toBe('string')
  return r.content[0].text
}

describe('MCP remember: remote write failure must not read as success', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-remember-syncfail-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  describe('remote write FAILS', () => {
    it('does not return the plain success text', async () => {
      const sync = makeMockSync({ insertOk: false, failureMessage: 'permission denied for table memories' })

      const result = await handleRemember(
        { key: 'fail-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      // The exact success form the tool used to emit unconditionally.
      expect(text).not.toContain('Stored memory: "fail-key"')
      // And no bare success claim of any kind.
      expect(text).not.toMatch(/^Stored memory: /)
    })

    it('states it is local-only, names the reason, and says teammates will not see it', async () => {
      const sync = makeMockSync({ insertOk: false, failureMessage: 'permission denied for table memories' })

      const result = await handleRemember(
        { key: 'fail-key-2', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).toContain('local cache only')
      expect(text).toContain('FAILED')
      // The reason recovered from the log line remoteInsert swallowed.
      expect(text).toContain('permission denied for table memories')
      // Unambiguous plain-language consequence for the reading LLM.
      expect(text).toContain('teammates will NOT see this memory')
      // Still identifies the memory it is talking about.
      expect(text).toContain('"fail-key-2" (convention)')
    })

    it('falls back to a generic reason when remoteInsert logs nothing', async () => {
      const sync = makeMockSync({ insertOk: false, logFailure: false })

      const result = await handleRemember(
        { key: 'silent-fail-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).not.toMatch(/^Stored memory: /)
      expect(text).toContain('local cache only')
      expect(text).toContain('the cloud write was rejected or the database was unreachable')
      expect(text).toContain('teammates will NOT see this memory')
    })

    it('does not throw, and leaves the memory durably saved and still dirty for a later sync', async () => {
      const sync = makeMockSync({ insertOk: false, failureMessage: 'network unreachable' })

      await expect(
        handleRemember(
          { key: 'dirty-key', value: 'a value', type: 'convention' },
          TEST_PROJECT,
          cache,
          sync,
        ),
      ).resolves.toBeDefined()

      // Durable locally...
      const row = cache.getByKey(TEST_PROJECT, 'dirty-key')
      expect(row).not.toBeNull()
      expect(row?.value).toBe('a value')
      // ...and NOT marked synced, so the background flush will retry it.
      expect(readDirty(dbPath, 'dirty-key')).toBe(1)
    })

    it('reports local-only when remoteInsert throws instead of returning false', async () => {
      // remoteInsert builds its WAL row OUTSIDE its own try block, so a WAL
      // failure escapes as a real throw. That must not fail the tool call.
      const sync = makeMockSync({ insertOk: false, throwOnInsert: new Error('WAL write failed') })

      const result = await handleRemember(
        { key: 'throw-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).not.toMatch(/^Stored memory: /)
      expect(text).toContain('local cache only')
      expect(text).toContain('WAL write failed')
      expect(readDirty(dbPath, 'throw-key')).toBe(1)
    })

    it('uses the local-only form for an UPDATE as well as a create', async () => {
      const okSync = makeMockSync({ insertOk: true })
      await handleRemember(
        { key: 'update-key', value: 'v1', type: 'convention' },
        TEST_PROJECT,
        cache,
        okSync,
      )

      const failSync = makeMockSync({ insertOk: false, failureMessage: 'row level security violation' })
      const result = await handleRemember(
        { key: 'update-key', value: 'v2', type: 'convention' },
        TEST_PROJECT,
        cache,
        failSync,
      )
      const text = expectMcpShape(result)

      expect(text).not.toMatch(/^Updated memory: /)
      expect(text).toContain('Updated memory in the local cache only')
      expect(text).toContain('row level security violation')
      expect(text).toContain('teammates will NOT see this memory')
    })
  })

  describe('remote write SUCCEEDS (regression guard)', () => {
    it('returns the existing success text, unchanged', async () => {
      const sync = makeMockSync({ insertOk: true })

      const result = await handleRemember(
        { key: 'ok-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).toBe('Stored memory: "ok-key" (convention)')
    })

    it('keeps the extras annotation on the success text', async () => {
      const sync = makeMockSync({ insertOk: true })

      const result = await handleRemember(
        {
          key: 'ok-extras-key',
          value: 'a value',
          type: 'convention',
          conditions: ['c1', 'c2'],
          crossSystemRefs: ['r1'],
        },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).toBe('Stored memory: "ok-extras-key" (convention) [2 conditions, 1 cross-refs]')
    })

    it('returns the existing update success text, unchanged', async () => {
      const sync = makeMockSync({ insertOk: true })

      await handleRemember(
        { key: 'ok-update-key', value: 'v1', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const result = await handleRemember(
        { key: 'ok-update-key', value: 'v2', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )
      const text = expectMcpShape(result)

      expect(text).toBe('Updated memory: "ok-update-key" (convention)')
    })

    it('marks the memory synced so no retry is queued', async () => {
      const sync = makeMockSync({ insertOk: true })

      await handleRemember(
        { key: 'ok-clean-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        sync,
      )

      expect(readDirty(dbPath, 'ok-clean-key')).toBe(0)
    })
  })

  describe('remote write NOT ATTEMPTED (no cloud sync configured)', () => {
    it('says local-only with the not-configured reason', async () => {
      const result = await handleRemember(
        { key: 'nosync-key', value: 'a value', type: 'convention' },
        TEST_PROJECT,
        cache,
        null,
      )
      const text = expectMcpShape(result)

      expect(text).not.toMatch(/^Stored memory: /)
      expect(text).toContain('local cache only')
      expect(text).toContain('Cloud sync is not configured for this project')
      expect(text).toContain('teammates will NOT see it')
    })
  })

  describe('response shape is unchanged on every path', () => {
    it('is identical in shape for success, failure, and no-sync', async () => {
      const okText = expectMcpShape(
        await handleRemember(
          { key: 'shape-ok', value: 'v', type: 'convention' },
          TEST_PROJECT,
          cache,
          makeMockSync({ insertOk: true }),
        ),
      )
      const failText = expectMcpShape(
        await handleRemember(
          { key: 'shape-fail', value: 'v', type: 'convention' },
          TEST_PROJECT,
          cache,
          makeMockSync({ insertOk: false }),
        ),
      )
      const noSyncText = expectMcpShape(
        await handleRemember(
          { key: 'shape-nosync', value: 'v', type: 'convention' },
          TEST_PROJECT,
          cache,
          null,
        ),
      )

      // Shape identical (asserted in expectMcpShape), text meaningfully different.
      expect(okText).not.toBe(failText)
      expect(okText).not.toBe(noSyncText)
    })
  })
})
