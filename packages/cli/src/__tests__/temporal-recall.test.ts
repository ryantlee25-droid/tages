import { describe, it, expect, vi } from 'vitest'
import { fetchTemporalCandidates } from '../lib/temporal-recall.js'

function makeMockSupabase(data: unknown[] | null, error: { message: string } | null = null) {
  const or = vi.fn().mockReturnThis()
  const order = vi.fn().mockReturnThis()
  const limit = vi.fn()
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or,
    order,
    limit,
  }
  limit.mockResolvedValue({ data, error })
  const from = vi.fn().mockReturnValue(chain)
  return { from, chain }
}

describe('fetchTemporalCandidates', () => {
  it('issues zero PostgREST calls for a non-temporal query', async () => {
    const { from } = makeMockSupabase([])
    const supabase = { from } as unknown as Parameters<typeof fetchTemporalCandidates>[0]

    const result = await fetchTemporalCandidates(supabase, 'proj-1', 'what causes this crash', 10)

    expect(result).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('issues zero PostgREST calls for a temporal query with no resolvable date', async () => {
    const { from } = makeMockSupabase([])
    const supabase = { from } as unknown as Parameters<typeof fetchTemporalCandidates>[0]

    // "when" is a strong temporal keyword but no concrete date is named.
    const result = await fetchTemporalCandidates(supabase, 'proj-1', 'when did we ship this', 10)

    expect(result).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('issues the expected filtered query and ranks results by proximity to the resolved date, nearest first', async () => {
    const rows = [
      { id: 'far', referenced_date: '2020-01-01T00:00:00.000Z', relative_date: null },
      { id: 'near', referenced_date: '2026-07-08T00:00:00.000Z', relative_date: null },
      { id: 'mid', referenced_date: '2026-01-01T00:00:00.000Z', relative_date: null },
    ]
    const { from, chain } = makeMockSupabase(rows)
    const supabase = { from } as unknown as Parameters<typeof fetchTemporalCandidates>[0]

    const result = await fetchTemporalCandidates(supabase, 'proj-1', 'what happened on 2026-07-09', 10)

    expect(from).toHaveBeenCalledWith('memories')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'proj-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'live')
    expect(chain.or).toHaveBeenCalledWith('referenced_date.not.is.null,relative_date.not.is.null')
    // Fix D: deterministic ordering + a generous cap (max(limit, 1000)) instead
    // of the old arbitrary `.limit(limit)` that could truncate away the nearest
    // row before the client proximity sort ran.
    expect(chain.order).toHaveBeenCalledWith('referenced_date', { ascending: true, nullsFirst: false })
    expect(chain.limit).toHaveBeenCalledWith(1000)

    expect(result.map((r) => r.id)).toEqual(['near', 'mid', 'far'])
  })

  it('includes the nearest-by-date row for the client sort even when it would fall outside the caller pool limit (Fix D)', async () => {
    // Simulate many date-carrying rows where the nearest-to-target sits late in
    // the set. Because the query now fetches a generous, ordered window (not an
    // arbitrary limit=poolSize truncation), the client proximity sort sees the
    // nearest row and surfaces it first.
    const rows = [
      { id: 'r1', referenced_date: '2020-01-01T00:00:00.000Z', relative_date: null },
      { id: 'r2', referenced_date: '2021-01-01T00:00:00.000Z', relative_date: null },
      { id: 'r3', referenced_date: '2022-01-01T00:00:00.000Z', relative_date: null },
      { id: 'nearest', referenced_date: '2026-07-09T00:00:00.000Z', relative_date: null },
    ]
    const { from, chain } = makeMockSupabase(rows)
    const supabase = { from } as unknown as Parameters<typeof fetchTemporalCandidates>[0]

    // Caller pool limit of 2 — the old code would have truncated to 2 arbitrary
    // rows server-side and could have dropped 'nearest' entirely.
    const result = await fetchTemporalCandidates(supabase, 'proj-1', 'what happened on 2026-07-09', 2)

    expect(chain.limit).toHaveBeenCalledWith(1000)
    expect(result[0].id).toBe('nearest')
  })

  it('returns an empty array (no throw) when the query errors', async () => {
    const { from } = makeMockSupabase(null, { message: 'boom' })
    const supabase = { from } as unknown as Parameters<typeof fetchTemporalCandidates>[0]

    const result = await fetchTemporalCandidates(supabase, 'proj-1', 'what happened on 2026-07-09', 10)

    expect(result).toEqual([])
  })
})
