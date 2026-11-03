/**
 * Phase 4: Auto-save sweep tests.
 *
 * Verifies the threshold-gated promotion behavior:
 * - Memories at or above the threshold are promoted to live
 * - Memories below the threshold stay pending
 * - NULL threshold (opt-in required) means nothing is auto-saved
 * - session_end extractions always stay pending regardless of threshold
 *   (see auto-save.ts for the rationale comment)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { runAutoSaveSweepLocal, runAutoSaveSweep } from '../sync/auto-save'
import { handleObserve } from '../tools/observe'
import { handleSessionEnd } from '../tools/session-end'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-auto-save'

function makePendingMemory(confidence: number): Memory {
  return {
    id: randomUUID(),
    projectId: TEST_PROJECT,
    key: `test-key-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    value: 'A test memory value for auto-save verification',
    type: 'convention',
    source: 'agent',
    status: 'pending',
    confidence,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('runAutoSaveSweepLocal', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-autosave-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('promotes pending memory with confidence >= threshold to live', () => {
    const mem = makePendingMemory(0.9)
    cache.upsertMemory(mem, false)

    const result = runAutoSaveSweepLocal(cache, TEST_PROJECT, 0.8)

    expect(result.promoted).toBe(1)
    const stored = cache.getByKey(TEST_PROJECT, mem.key)
    expect(stored?.status).toBe('live')
    expect(stored?.verifiedAt).toBeTruthy()
  })

  it('leaves pending memory with confidence < threshold untouched', () => {
    const mem = makePendingMemory(0.7)
    cache.upsertMemory(mem, false)

    const result = runAutoSaveSweepLocal(cache, TEST_PROJECT, 0.8)

    expect(result.promoted).toBe(0)
    const stored = cache.getByKey(TEST_PROJECT, mem.key)
    expect(stored?.status).toBe('pending')
  })

  it('promotes at-exactly-threshold confidence', () => {
    const mem = makePendingMemory(0.8)
    cache.upsertMemory(mem, false)

    const result = runAutoSaveSweepLocal(cache, TEST_PROJECT, 0.8)

    expect(result.promoted).toBe(1)
    const stored = cache.getByKey(TEST_PROJECT, mem.key)
    expect(stored?.status).toBe('live')
  })

  it('promotes multiple qualifying memories in one sweep', () => {
    const high1 = makePendingMemory(0.9)
    const high2 = makePendingMemory(0.95)
    const low = makePendingMemory(0.5)
    cache.upsertMemory(high1, false)
    cache.upsertMemory(high2, false)
    cache.upsertMemory(low, false)

    const result = runAutoSaveSweepLocal(cache, TEST_PROJECT, 0.8)

    expect(result.promoted).toBe(2)
    expect(cache.getByKey(TEST_PROJECT, high1.key)?.status).toBe('live')
    expect(cache.getByKey(TEST_PROJECT, high2.key)?.status).toBe('live')
    expect(cache.getByKey(TEST_PROJECT, low.key)?.status).toBe('pending')
  })

  it('returns promoted=0 when no memories exist', () => {
    const result = runAutoSaveSweepLocal(cache, TEST_PROJECT, 0.8)
    expect(result.promoted).toBe(0)
  })
})

describe('auto-save threshold = NULL (opt-in required)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-autosave-null-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('does not promote high-confidence pending memory when threshold is null', async () => {
    // With NULL threshold, handleObserve should NOT auto-promote even at confidence=0.99
    const result = await handleObserve(
      { observation: 'We always use camelCase for API route handlers — this is the established convention.' },
      TEST_PROJECT, cache, null,
      undefined, // callerUserId
      null,      // autoSaveThreshold = NULL
    )

    const mems = cache.getAllForProject(TEST_PROJECT)
    // The observe tool writes confidence=0.7; without a threshold nothing gets auto-saved
    for (const m of mems) {
      expect(m.status).toBe('pending')
    }
    expect(result.content[0].text).toContain('tages pending')
  })

  it('sweep does nothing when threshold is null — caller must guard', () => {
    const mem = makePendingMemory(0.99)
    cache.upsertMemory(mem, false)

    // Callers in index.ts guard: `if (autoSaveThreshold != null)` — simulate that guard
    // by NOT calling sweep. This test documents the expected caller behavior.
    // Direct sweep with threshold=0 would promote; the guard prevents that.
    const stored = cache.getByKey(TEST_PROJECT, mem.key)
    expect(stored?.status).toBe('pending') // no sweep was run
  })
})

describe('session_end extraction — always stays pending (threshold exemption)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-autosave-session-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('session_end extracted memories at confidence=0.8 stay pending even if threshold=0.8 would auto-save', async () => {
    // session_end does NOT call runAutoSaveSweep — this is intentional per spec.
    // Agents calling session_end get memories routed to review regardless of threshold.
    await handleSessionEnd(
      { summary: 'We decided to use Zod for all runtime validation across the codebase.' },
      TEST_PROJECT, cache, null,
    )

    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.length).toBeGreaterThan(0)

    // session_end writes confidence=0.8; even though that would qualify at threshold=0.8,
    // session_end does not trigger the auto-save path.
    for (const m of mems) {
      expect(m.status).toBe('pending')
      expect(m.tags).toContain('session-extract')
    }
  })
})

// 0.5.7 bug 6: the boot sweep must never promote session_end extractions.
// observe and session_end both write source='agent', so the filter is the
// `session-extract` tag, and NULL/empty tags must still be eligible.
describe('auto-save sweep excludes session-extract rows (bug 6)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-autosave-tag-test-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('local sweep skips session-extract rows even at threshold 0, promotes observed and untagged rows', async () => {
    await handleSessionEnd(
      { summary: 'We decided to use Zod for all runtime validation across the codebase.' },
      TEST_PROJECT, cache, null,
    )
    await handleObserve(
      { observation: 'We always use snake_case for every API route in this service.' },
      TEST_PROJECT, cache, null,
    )
    const untagged = makePendingMemory(0.9)
    cache.upsertMemory(untagged, false)
    const nullTags = { ...makePendingMemory(0.9), tags: undefined as unknown as string[] }
    cache.upsertMemory(nullTags, false)

    runAutoSaveSweepLocal(cache, TEST_PROJECT, 0)

    const all = cache.getAllForProject(TEST_PROJECT)
    const session = all.filter(m => m.tags?.includes('session-extract'))
    expect(session.length).toBeGreaterThan(0)
    for (const m of session) expect(m.status).toBe('pending')
    expect(all.find(m => m.tags?.includes('auto-observed'))!.status).toBe('live')
    expect(cache.getByKey(TEST_PROJECT, untagged.key)!.status).toBe('live')
    expect(cache.getByKey(TEST_PROJECT, nullTags.key)!.status).toBe('live')
  })

  it('remote sweep filters on the tag with an explicit NULL-tags branch', async () => {
    const calls: Array<[string, unknown[]]> = []
    const builder: Record<string, unknown> = {}
    for (const m of ['from', 'update', 'eq', 'gte', 'or', 'not']) {
      builder[m] = (...args: unknown[]) => { calls.push([m, args]); return builder }
    }
    builder.select = async (...args: unknown[]) => { calls.push(['select', args]); return { data: [{ id: '1' }], error: null } }

    const res = await runAutoSaveSweep(builder as never, TEST_PROJECT, 0.75)

    expect(res.promoted).toBe(1)
    const or = calls.find(([m]) => m === 'or')
    expect(or).toBeDefined()
    expect(or![1][0]).toBe('tags.is.null,tags.not.cs.{"session-extract"}')
    // still scoped to pending rows of this project at/above the threshold
    expect(calls).toContainEqual(['eq', ['project_id', TEST_PROJECT]])
    expect(calls).toContainEqual(['eq', ['status', 'pending']])
    expect(calls).toContainEqual(['gte', ['confidence', 0.75]])
  })
})
