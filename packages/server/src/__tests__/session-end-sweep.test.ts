/**
 * T2: Pending memory auto-promotion sweep — session-end integration tests.
 *
 * Covers:
 *  (a) Below-threshold pending memory stays pending after session-end sweep.
 *  (b) At/above-threshold pending memory is promoted to live.
 *  (c) Already-live memory is not double-promoted (idempotency).
 *  (d) Empty pending set is a no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleSessionEnd } from '../tools/session-end'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-session-sweep'

function makePendingMemory(confidence: number, key?: string): Memory {
  return {
    id: randomUUID(),
    projectId: TEST_PROJECT,
    key: key ?? `sweep-key-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    value: 'Auto-promotion sweep test memory',
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

describe('handleSessionEnd — pending memory auto-promotion sweep (T2)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-sweep-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  // (a) Below-threshold pending stays pending
  it('(a) pending memory below threshold stays pending after session-end with sweep', async () => {
    const mem = makePendingMemory(0.6)
    cache.upsertMemory(mem, false)

    await handleSessionEnd(
      { summary: 'Done for today.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8, // threshold — 0.6 < 0.8, so no promotion
    )

    const stored = cache.getByKey(TEST_PROJECT, mem.key)
    expect(stored?.status).toBe('pending')
  })

  // (b) At/above-threshold pending gets promoted to live
  it('(b) pending memory at threshold is promoted to live', async () => {
    const at = makePendingMemory(0.8, 'sweep-at-threshold')
    const above = makePendingMemory(0.95, 'sweep-above-threshold')
    cache.upsertMemory(at, false)
    cache.upsertMemory(above, false)

    await handleSessionEnd(
      { summary: 'Done for today.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8, // threshold
    )

    expect(cache.getByKey(TEST_PROJECT, 'sweep-at-threshold')?.status).toBe('live')
    expect(cache.getByKey(TEST_PROJECT, 'sweep-above-threshold')?.status).toBe('live')
  })

  it('(b) pending memory above threshold has verifiedAt set after promotion', async () => {
    const mem = makePendingMemory(0.9, 'sweep-verified-at')
    cache.upsertMemory(mem, false)

    const before = new Date().toISOString()
    await handleSessionEnd(
      { summary: 'Done.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8,
    )
    const after = new Date().toISOString()

    const stored = cache.getByKey(TEST_PROJECT, 'sweep-verified-at')
    expect(stored?.status).toBe('live')
    expect(stored?.verifiedAt).toBeTruthy()
    expect(stored!.verifiedAt! >= before).toBe(true)
    expect(stored!.verifiedAt! <= after).toBe(true)
  })

  // (c) Already-promoted (live) memory is not re-promoted — idempotency
  it('(c) already-live memory is not double-promoted (idempotent)', async () => {
    const liveKey = 'sweep-already-live'
    const liveMem = makePendingMemory(0.95, liveKey)
    // Seed as live directly
    cache.upsertMemory({ ...liveMem, status: 'live' }, false)

    const storedBefore = cache.getByKey(TEST_PROJECT, liveKey)
    expect(storedBefore?.status).toBe('live')
    const verifiedAtBefore = storedBefore?.verifiedAt

    await handleSessionEnd(
      { summary: 'Done.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8,
    )

    const storedAfter = cache.getByKey(TEST_PROJECT, liveKey)
    // Status stays live — not re-promoted or reverted
    expect(storedAfter?.status).toBe('live')
    // verifiedAt should not have been overwritten by the sweep
    expect(storedAfter?.verifiedAt).toBe(verifiedAtBefore)
  })

  it('(c) running sweep twice on same data does not change outcome', async () => {
    const mem = makePendingMemory(0.9, 'sweep-idempotent')
    cache.upsertMemory(mem, false)

    // First sweep
    await handleSessionEnd(
      { summary: 'Done.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8,
    )
    const afterFirst = cache.getByKey(TEST_PROJECT, 'sweep-idempotent')
    expect(afterFirst?.status).toBe('live')

    // Second sweep — same threshold, same data
    await handleSessionEnd(
      { summary: 'Done again.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.8,
    )
    const afterSecond = cache.getByKey(TEST_PROJECT, 'sweep-idempotent')
    expect(afterSecond?.status).toBe('live')
    // verifiedAt should not have changed on second sweep
    expect(afterSecond?.verifiedAt).toBe(afterFirst?.verifiedAt)
  })

  // (d) Empty pending set is a no-op
  it('(d) empty pending set is a no-op — no error, no state change', async () => {
    // No memories seeded — project is empty
    await expect(
      handleSessionEnd(
        { summary: 'Done.', extractMemories: false },
        TEST_PROJECT, cache, null,
        undefined,
        0.8,
      )
    ).resolves.toBeDefined()

    const all = cache.getAllForProject(TEST_PROJECT)
    expect(all).toHaveLength(0)
  })

  it('(d) sweep with no pending memories returns valid session result', async () => {
    const result = await handleSessionEnd(
      { summary: 'Done for today.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      0.5,
    )
    expect(result.content[0].type).toBe('text')
    expect(typeof result.content[0].text).toBe('string')
  })

  // Guard: null threshold means sweep is skipped entirely
  it('null threshold skips sweep — high-confidence pending stays pending', async () => {
    const mem = makePendingMemory(0.99, 'sweep-null-threshold')
    cache.upsertMemory(mem, false)

    await handleSessionEnd(
      { summary: 'Done.', extractMemories: false },
      TEST_PROJECT, cache, null,
      undefined,
      null, // no threshold
    )

    expect(cache.getByKey(TEST_PROJECT, 'sweep-null-threshold')?.status).toBe('pending')
  })
})
