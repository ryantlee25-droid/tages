/**
 * Regression tests: promotions and verifications must address the REMOTE row
 * by (project_id, key), never by the local SQLite row id.
 *
 * The bug: `remoteInsert` / `_flushMemories` strip `id` from the upsert
 * payload and conflict on `project_id,key`, so Supabase assigns its own uuid
 * while the local row keeps the `randomUUID()` it was created with. Two call
 * sites then updated the remote row with `.eq('id', memory.id)`:
 *
 *   - tools/observe.ts   — auto-save promotion to status='live'
 *   - tools/verify.ts    — verify_memory, via remoteVerifyMemory
 *
 * Both matched ZERO rows. The remote row stayed `pending`, and because every
 * recall path filters `status='live'`, no teammate ever saw the memory — while
 * the local cache happily reported it as promoted. Same id-divergence bug class
 * as PR #70's embedding update and the chunk-sync bug.
 *
 * The fake Supabase client below reproduces the divergence faithfully: on
 * upsert it DISCARDS any client-sent id and mints its own, keying rows on
 * (project_id, key). So a regression to `.eq('id', ...)` makes these tests fail
 * rather than silently pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import { SupabaseSync } from '../sync/supabase-sync'
import { handleObserve } from '../tools/observe'
import { handleVerifyMemory } from '../tools/verify'

const TEST_PROJECT = 'proj-remote-id'

type FakeRow = Record<string, unknown> & {
  id: string
  project_id: string
  key: string
  status: string
}

interface UpdateCall {
  table: string
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

/**
 * In-memory stand-in for Supabase that models the id divergence:
 * `upsert` ignores any incoming `id` and assigns a remote-only uuid, matching
 * existing rows on the real conflict target (project_id, key).
 */
function makeFakeSupabase() {
  const rows: FakeRow[] = []
  const updateCalls: UpdateCall[] = []

  const supabase = {
    from: vi.fn((table: string) => ({
      upsert: vi.fn((row: Record<string, unknown>) => {
        const existing = rows.find(
          (r) => r.project_id === row.project_id && r.key === row.key,
        )
        if (existing) {
          // Conflict update never touches the server-assigned id.
          const { id: _ignored, ...rest } = row
          Object.assign(existing, rest)
        } else {
          const { id: _ignored, ...rest } = row
          rows.push({ ...rest, id: `remote-${randomUUID()}` } as FakeRow)
        }
        return Promise.resolve({ error: null })
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = []
        const builder = {
          eq(col: string, val: unknown) {
            filters.push([col, val])
            return builder
          },
          then(resolve: (v: { error: null }) => unknown) {
            updateCalls.push({ table, payload, filters })
            for (const row of rows) {
              const matches = filters.every(([col, val]) => row[col] === val)
              if (matches) Object.assign(row, payload)
            }
            return Promise.resolve({ error: null }).then(resolve)
          },
        }
        return builder
      }),
    })),
  }

  return { supabase, rows, updateCalls }
}

/** What a teammate's recall sees — every recall path filters status='live'. */
function liveRecall(rows: FakeRow[], projectId: string): FakeRow[] {
  return rows.filter((r) => r.project_id === projectId && r.status === 'live')
}

function filterColumns(call: UpdateCall): string[] {
  return call.filters.map(([col]) => col)
}

function pendingMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    projectId: TEST_PROJECT,
    key: 'staged-key',
    value: 'A staged memory awaiting verification',
    type: 'convention',
    source: 'agent',
    status: 'pending',
    confidence: 0.7,
    filePaths: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('SupabaseSync.remoteVerifyMemory — keyed by (project_id, key)', () => {
  it('filters on project_id + key, never on a bare id', async () => {
    const { supabase, rows, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, TEST_PROJECT)

    const memory = pendingMemory()
    await sync.remoteInsert(memory)

    // Sanity: the fixture actually reproduces the divergence this test guards.
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(memory.id)

    const verifiedAt = '2026-08-13T00:00:00.000Z'
    const ok = await sync.remoteVerifyMemory(TEST_PROJECT, memory.key, verifiedAt)

    expect(ok).toBe(true)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].filters).toEqual([
      ['project_id', TEST_PROJECT],
      ['key', memory.key],
    ])
    expect(filterColumns(updateCalls[0])).not.toContain('id')
  })

  it('actually flips the remote row to live with the verified_at timestamp', async () => {
    const { supabase, rows } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, TEST_PROJECT)

    const memory = pendingMemory()
    await sync.remoteInsert(memory)
    expect(rows[0].status).toBe('pending')

    const verifiedAt = '2026-08-13T00:00:00.000Z'
    await sync.remoteVerifyMemory(TEST_PROJECT, memory.key, verifiedAt)

    expect(rows[0].status).toBe('live')
    expect(rows[0].verified_at).toBe(verifiedAt)
  })

  it('sets ONLY status and verified_at (never reverts a concurrent field write)', async () => {
    const { supabase, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, TEST_PROJECT)

    await sync.remoteVerifyMemory(TEST_PROJECT, 'k', '2026-08-13T00:00:00.000Z')

    expect(updateCalls[0].payload).toEqual({
      status: 'live',
      verified_at: '2026-08-13T00:00:00.000Z',
    })
  })

  it('is an update, not an upsert — a missing remote row is a no-op, not a resurrection', async () => {
    const { supabase, rows } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, TEST_PROJECT)

    const ok = await sync.remoteVerifyMemory(TEST_PROJECT, 'never-written', '2026-08-13T00:00:00.000Z')

    expect(ok).toBe(true)
    expect(rows).toHaveLength(0)
  })
})

describe('handleObserve auto-save promotion — remote row reaches status=live', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-observe-remote-id-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  const OBSERVATION =
    'We always use camelCase for API route handlers — this is the established convention.'

  it('promotes the remote row by (project_id, key), not by the local id', async () => {
    const { supabase, rows, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    // observe writes confidence 0.7; threshold 0.7 triggers immediate auto-save.
    const result = await handleObserve(
      { observation: OBSERVATION },
      TEST_PROJECT,
      cache,
      sync,
      undefined,
      0.7,
    )

    expect(result.content[0].text).toContain('auto-saved')

    const local = cache.getAllForProject(TEST_PROJECT)
    expect(local).toHaveLength(1)
    const localMemory = local[0]

    // The fixture reproduces the divergence: remote id !== local id.
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(localMemory.id)

    // The promotion update must be keyed on the business key.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).toBe('memories')
    expect(updateCalls[0].filters).toEqual([
      ['project_id', TEST_PROJECT],
      ['key', localMemory.key],
    ])
    expect(filterColumns(updateCalls[0])).not.toContain('id')
    // The old code filtered by the local uuid, which matched nothing.
    expect(updateCalls[0].filters).not.toContainEqual(['id', localMemory.id])
  })

  it('leaves BOTH the local and the remote row live (no local/remote divergence)', async () => {
    const { supabase, rows } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    await handleObserve(
      { observation: OBSERVATION },
      TEST_PROJECT,
      cache,
      sync,
      undefined,
      0.7,
    )

    const localMemory = cache.getAllForProject(TEST_PROJECT)[0]
    expect(localMemory.status).toBe('live')
    expect(rows[0].status).toBe('live')
    expect(rows[0].verified_at).toBeTruthy()
  })

  it("regression: a memory promoted via observe is visible to a teammate's status='live' recall", async () => {
    const { supabase, rows } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    await handleObserve(
      { observation: OBSERVATION },
      TEST_PROJECT,
      cache,
      sync,
      undefined,
      0.7,
    )

    // This is the whole point of the fix. Before it, the remote row was still
    // 'pending' and this came back empty for every teammate.
    const visible = liveRecall(rows, TEST_PROJECT)
    expect(visible).toHaveLength(1)
    expect(visible[0].key).toBe(cache.getAllForProject(TEST_PROJECT)[0].key)
    expect(visible[0].value).toBe(OBSERVATION)
  })

  it('below-threshold observations stay pending remotely and are NOT recallable', async () => {
    const { supabase, rows, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    await handleObserve(
      { observation: OBSERVATION },
      TEST_PROJECT,
      cache,
      sync,
      undefined,
      0.95, // above observe's 0.7 confidence — no promotion
    )

    expect(updateCalls).toHaveLength(0)
    expect(rows[0].status).toBe('pending')
    expect(liveRecall(rows, TEST_PROJECT)).toHaveLength(0)
  })
})

describe('handleVerifyMemory — remote promotion keyed by (project_id, key)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-verify-remote-id-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('updates the remote row by project_id + key and makes it live-recallable', async () => {
    const { supabase, rows, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    const memory = pendingMemory({ key: 'convention-needs-verify' })
    cache.upsertMemory(memory, false)
    await sync.remoteInsert(memory)

    expect(rows[0].id).not.toBe(memory.id)
    expect(liveRecall(rows, TEST_PROJECT)).toHaveLength(0)

    const result = await handleVerifyMemory(
      { key: 'convention-needs-verify' },
      TEST_PROJECT,
      cache,
      sync,
    )

    expect(result.content[0].text).toContain('now live')

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].filters).toEqual([
      ['project_id', TEST_PROJECT],
      ['key', 'convention-needs-verify'],
    ])
    expect(filterColumns(updateCalls[0])).not.toContain('id')
    expect(updateCalls[0].filters).not.toContainEqual(['id', memory.id])

    // Local and remote agree, and a teammate's recall now sees it.
    expect(cache.getByKey(TEST_PROJECT, 'convention-needs-verify')?.status).toBe('live')
    expect(liveRecall(rows, TEST_PROJECT)).toHaveLength(1)
  })

  it('does not touch the remote when the memory is already live', async () => {
    const { supabase, updateCalls } = makeFakeSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, TEST_PROJECT)

    const memory = pendingMemory({ key: 'already-live', status: 'live' })
    cache.upsertMemory(memory, false)

    const result = await handleVerifyMemory({ key: 'already-live' }, TEST_PROJECT, cache, sync)

    expect(result.content[0].text).toContain('already verified')
    expect(updateCalls).toHaveLength(0)
  })
})
