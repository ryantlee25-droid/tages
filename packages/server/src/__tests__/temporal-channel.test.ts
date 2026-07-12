/**
 * Tests for PLAN.md Task 7 — temporal date-range retrieval channel parity,
 * server package. Mirrors the CLI's Task 3 test cases: zero-cost skip for
 * non-temporal/no-resolvable-date queries, proximity-ranked results for
 * resolvable ones.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Memory } from '@tages/shared'
import { fetchTemporalCandidates, fuseTemporalChannel } from '../search/temporal-channel'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    projectId: 'proj-1',
    key: 'test-key',
    value: 'test value',
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Minimal fake SupabaseClient covering only the query-builder surface
// fetchTemporalCandidates uses (.from().select().eq().eq().or().order().limit()).
function makeFakeSupabase(rows: unknown[]) {
  const calls = { limit: [] as number[], order: [] as unknown[][] }
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn((...args: unknown[]) => { calls.order.push(args); return builder }),
    limit: vi.fn(async (n: number) => { calls.limit.push(n); return { data: rows, error: null } }),
  }
  const from = vi.fn(() => builder)
  return { from, __builder: builder, __calls: calls } as unknown as {
    from: typeof from
    __builder: typeof builder
    __calls: typeof calls
  }
}

describe('fetchTemporalCandidates', () => {
  it('issues zero PostgREST calls for a non-temporal query', async () => {
    const supabase = makeFakeSupabase([])
    const result = await fetchTemporalCandidates(supabase as never, 'proj-1', 'what is our auth pattern', 20)
    expect(result).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('issues zero PostgREST calls for a temporal query with no resolvable date', async () => {
    const supabase = makeFakeSupabase([])
    // "when did I last deploy" is temporal (isTemporalQuery) but has no
    // extractable concrete date — extractTargetDate returns undefined.
    const result = await fetchTemporalCandidates(supabase as never, 'proj-1', 'when did I last deploy', 20)
    expect(result).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('queries and ranks by proximity to the resolved target date, nearest first', async () => {
    const near = {
      id: 'near',
      project_id: 'proj-1',
      key: 'near-key',
      value: 'v',
      type: 'convention',
      source: 'manual',
      status: 'live',
      confidence: 1,
      file_paths: [],
      tags: [],
      referenced_date: '2026-07-09',
      created_at: '2026-07-09T00:00:00.000Z',
      updated_at: '2026-07-09T00:00:00.000Z',
    }
    const far = {
      id: 'far',
      project_id: 'proj-1',
      key: 'far-key',
      value: 'v',
      type: 'convention',
      source: 'manual',
      status: 'live',
      confidence: 1,
      file_paths: [],
      tags: [],
      referenced_date: '2026-01-01',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }

    const supabase = makeFakeSupabase([far, near])
    const result = await fetchTemporalCandidates(supabase as never, 'proj-1', 'what happened on July 9, 2026', 20)

    expect(supabase.from).toHaveBeenCalledWith('memories')
    expect(result.map((m) => m.id)).toEqual(['near', 'far'])
  })

  it('fetches a deterministic, generously-capped window (Fix D) instead of an arbitrary .limit(limit) truncation', async () => {
    const near = {
      id: 'near', project_id: 'proj-1', key: 'k', value: 'v', type: 'convention',
      source: 'manual', status: 'live', confidence: 1, file_paths: [], tags: [],
      referenced_date: '2026-07-09', created_at: '2026-07-09T00:00:00.000Z', updated_at: '2026-07-09T00:00:00.000Z',
    }
    const supabase = makeFakeSupabase([near])

    await fetchTemporalCandidates(supabase as never, 'proj-1', 'what happened on July 9, 2026', 20)

    // Deterministic ordering (not arbitrary PostgREST default) ...
    expect(supabase.__builder.order).toHaveBeenCalledWith('referenced_date', { ascending: true, nullsFirst: false })
    // ... and a cap far larger than the passed pool limit (20), so effectively
    // ALL date-carrying rows are returned for the client proximity sort — the
    // nearest-by-date row can no longer be truncated away before ranking.
    expect(supabase.__calls.limit[0]).toBe(1000)
  })

  it('excludes rows with no content-anchored date (zero proximity)', async () => {
    const noDate = {
      id: 'no-date',
      project_id: 'proj-1',
      key: 'no-date-key',
      value: 'v',
      type: 'convention',
      source: 'manual',
      status: 'live',
      confidence: 1,
      file_paths: [],
      tags: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const supabase = makeFakeSupabase([noDate])
    const result = await fetchTemporalCandidates(supabase as never, 'proj-1', 'what happened on July 9, 2026', 20)
    expect(result).toEqual([])
  })
})

describe('fuseTemporalChannel', () => {
  it('returns the hybrid list unchanged when there are no temporal candidates', () => {
    const hybrid = [makeMemory({ id: 'a' }), makeMemory({ id: 'b' })]
    expect(fuseTemporalChannel(hybrid, [])).toEqual(hybrid)
  })

  it('fuses a memory found only via the temporal channel into the result', () => {
    const hybrid = [makeMemory({ id: 'a' }), makeMemory({ id: 'b' })]
    const temporalOnly = makeMemory({ id: 'temporal-only' })
    const fused = fuseTemporalChannel(hybrid, [temporalOnly])
    expect(fused.map((m) => m.id)).toContain('temporal-only')
  })

  it('ranks an item appearing first in both lists above one appearing in only one', () => {
    const shared = makeMemory({ id: 'shared' })
    const hybridOnly = makeMemory({ id: 'hybrid-only' })
    const fused = fuseTemporalChannel([shared, hybridOnly], [shared])
    expect(fused[0].id).toBe('shared')
  })
})
