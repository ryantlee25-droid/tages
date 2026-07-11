/**
 * Tests for Task 9 (Phase 2)'s chunk-sync key-resolution path in
 * supabase-sync.ts:
 *
 *   - remoteUpsertChunks resolves the authoritative remote memory id via
 *     (project_id, key), NOT a locally-generated id — remote memory upserts
 *     strip the local id (Supabase keeps/assigns its own), so a local id
 *     routinely diverges from the remote row's real id. Keying the
 *     delete/insert on a local id was caught live on the dev eval stranding
 *     42 local chunk rows / 0 remote.
 *   - remoteUpsertChunks fails OPEN (returns false, no delete/insert issued)
 *     when the parent memory isn't found on remote yet (or was deleted),
 *     rather than risking a misattached chunk set.
 *   - _flushDirtyChunks (private, reached via flush()) wires
 *     getDirtyChunkGroups -> getKeyById -> remoteUpsertChunks ->
 *     markChunksSynced, and skips a group entirely (no remote call at all)
 *     when getKeyById can't resolve the local id to a (project_id, key).
 *
 * We can't hit real Supabase, so we exercise both via a mocked client and a
 * fake SqliteCache double, inspecting exactly what queries would be issued.
 */

import { describe, it, expect, vi } from 'vitest'
import { SupabaseSync, embeddingToPgVector } from '../sync/supabase-sync'
import type { SqliteCache } from '../cache/sqlite'

function makeSupabaseMock(
  opts: {
    parentsByKey?: Record<string, { id: string } | null>
    deleteError?: { message: string } | null
    insertError?: { message: string } | null
  } = {},
) {
  const selectCalls: Array<{ projectId?: string; key?: string }> = []
  const deleteCalls: string[] = []
  const insertCalls: unknown[][] = []
  const fromCalls: string[] = []

  const supabase = {
    from: vi.fn((table: string) => {
      fromCalls.push(table)
      if (table === 'memories') {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {}
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val
                return builder
              }),
              maybeSingle: vi.fn(() => {
                const projectId = filters['project_id'] as string | undefined
                const key = filters['key'] as string | undefined
                selectCalls.push({ projectId, key })
                const parent = (key && opts.parentsByKey?.[key]) ?? null
                return Promise.resolve({ data: parent, error: null })
              }),
            }
            return builder
          }),
        }
      }
      if (table === 'memory_chunks') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn((_col: string, memoryId: string) => {
              deleteCalls.push(memoryId)
              return Promise.resolve({ error: opts.deleteError ?? null })
            }),
          })),
          insert: vi.fn((rows: unknown[]) => {
            insertCalls.push(rows)
            return Promise.resolve({ error: opts.insertError ?? null })
          }),
        }
      }
      throw new Error(`Unexpected table in test mock: ${table}`)
    }),
  }

  return { supabase, selectCalls, deleteCalls, insertCalls, fromCalls }
}

describe('SupabaseSync.remoteUpsertChunks — (project_id, key) resolution', () => {
  it('resolves the AUTHORITATIVE remote id via (project_id, key), then deletes/inserts keyed on that remote id, not the local key args', async () => {
    const { supabase, selectCalls, deleteCalls, insertCalls } = makeSupabaseMock({
      parentsByKey: { 'stripe-key': { id: 'remote-memory-id-999' } },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const chunks = [
      { text: 'chunk zero', embedding: [0.1, 0.2] },
      { text: 'chunk one', embedding: [0.3, 0.4] },
    ]
    const ok = await sync.remoteUpsertChunks('proj-1', 'stripe-key', chunks)

    expect(ok).toBe(true)
    // Parent resolved by (project_id, key), never a memory id.
    expect(selectCalls).toEqual([{ projectId: 'proj-1', key: 'stripe-key' }])
    // Delete + insert are keyed on the RESOLVED remote id, not the local
    // 'proj-1'/'stripe-key' args.
    expect(deleteCalls).toEqual(['remote-memory-id-999'])
    expect(insertCalls).toHaveLength(1)
    const rows = insertCalls[0] as Array<{ memory_id: string; chunk_index: number; chunk_text: string; embedding: string }>
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.memory_id === 'remote-memory-id-999')).toBe(true)
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1])
    expect(rows[0].chunk_text).toBe('chunk zero')
    expect(rows[0].embedding).toBe(embeddingToPgVector(chunks[0].embedding))
  })

  it('fails open (returns false, issues NO delete/insert) when the parent memory is not on remote yet or was deleted', async () => {
    const { supabase, deleteCalls, insertCalls } = makeSupabaseMock({
      parentsByKey: {}, // no key resolves — maybeSingle() returns { data: null }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const ok = await sync.remoteUpsertChunks('proj-1', 'never-synced-key', [
      { text: 'orphaned chunk', embedding: [0.1] },
    ])

    expect(ok).toBe(false)
    // Fail-open: never issues a delete or insert against an unresolved
    // parent — the chunk rows stay dirty locally for a later retry rather
    // than risking a misattached row against the wrong memory_id.
    expect(deleteCalls).toEqual([])
    expect(insertCalls).toEqual([])
  })
})

describe('SupabaseSync._flushDirtyChunks (via flush()) — full wiring', () => {
  function makeCache(
    overrides: Partial<{
      getDirtyChunkGroups: () => Array<{ memoryId: string; projectId: string }>
      getKeyById: (id: string) => { projectId: string; key: string } | null
      getChunksForMemory: (id: string) => Array<{ text: string; embedding: number[] }>
    }> = {},
  ) {
    const markChunksSynced = vi.fn()
    const getKeyById = vi.fn(overrides.getKeyById ?? (() => null))
    const getChunksForMemory = vi.fn(overrides.getChunksForMemory ?? (() => []))
    const cache = {
      // _flushMemories runs first inside _flush(); an empty dirty list makes
      // it a no-op so it doesn't interfere with these chunk-only assertions.
      getDirty: vi.fn(() => []),
      markSynced: vi.fn(),
      getDirtyChunkGroups: vi.fn(overrides.getDirtyChunkGroups ?? (() => [])),
      getKeyById,
      getChunksForMemory,
      markChunksSynced,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { cache: cache as any as SqliteCache, markChunksSynced, getKeyById, getChunksForMemory }
  }

  it('wires getDirtyChunkGroups -> getKeyById -> remoteUpsertChunks(project_id, key) -> markChunksSynced(local id)', async () => {
    const { cache, markChunksSynced, getKeyById, getChunksForMemory } = makeCache({
      getDirtyChunkGroups: () => [{ memoryId: 'local-mem-1', projectId: 'proj-1' }],
      getKeyById: (id) => (id === 'local-mem-1' ? { projectId: 'proj-1', key: 'stripe-key' } : null),
      getChunksForMemory: (id) =>
        id === 'local-mem-1' ? [{ text: 'chunk zero', embedding: [0.1, 0.2] }] : [],
    })
    const { supabase, selectCalls, deleteCalls, insertCalls } = makeSupabaseMock({
      parentsByKey: { 'stripe-key': { id: 'remote-mem-1' } },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, 'proj-1')

    await sync.flush()

    expect(getKeyById).toHaveBeenCalledWith('local-mem-1')
    expect(getChunksForMemory).toHaveBeenCalledWith('local-mem-1')
    // Chunk parent resolved via the (project_id, key) getKeyById returned,
    // not the local memory id.
    expect(selectCalls).toEqual([{ projectId: 'proj-1', key: 'stripe-key' }])
    expect(deleteCalls).toEqual(['remote-mem-1'])
    expect(insertCalls).toHaveLength(1)
    // Local sync-state bookkeeping is keyed on the LOCAL memory id (cache's
    // own primary key), not the remote id.
    expect(markChunksSynced).toHaveBeenCalledWith('local-mem-1')
  })

  it('skips a group entirely (no remote call, no markChunksSynced) when getKeyById cannot resolve the local id', async () => {
    const { cache, markChunksSynced, getChunksForMemory } = makeCache({
      getDirtyChunkGroups: () => [{ memoryId: 'orphan-mem', projectId: 'proj-1' }],
      getKeyById: () => null,
    })
    const { supabase, fromCalls } = makeSupabaseMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, 'proj-1')

    await sync.flush()

    // continue on !local — never even looks up the chunks to send, let
    // alone issues any Supabase call for this group.
    expect(getChunksForMemory).not.toHaveBeenCalled()
    expect(fromCalls).toEqual([])
    expect(markChunksSynced).not.toHaveBeenCalled()
  })

  it('marks only the resolvable group synced when one group in a batch fails getKeyById and another succeeds', async () => {
    const { cache, markChunksSynced } = makeCache({
      getDirtyChunkGroups: () => [
        { memoryId: 'orphan-mem', projectId: 'proj-1' },
        { memoryId: 'good-mem', projectId: 'proj-1' },
      ],
      getKeyById: (id) => (id === 'good-mem' ? { projectId: 'proj-1', key: 'good-key' } : null),
      getChunksForMemory: (id) => (id === 'good-mem' ? [{ text: 'c', embedding: [0.1] }] : []),
    })
    const { supabase, selectCalls } = makeSupabaseMock({
      parentsByKey: { 'good-key': { id: 'remote-good' } },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, cache, 'proj-1')

    await sync.flush()

    // Only the resolvable group ever reaches a remote parent lookup.
    expect(selectCalls).toEqual([{ projectId: 'proj-1', key: 'good-key' }])
    expect(markChunksSynced).toHaveBeenCalledTimes(1)
    expect(markChunksSynced).toHaveBeenCalledWith('good-mem')
  })
})
