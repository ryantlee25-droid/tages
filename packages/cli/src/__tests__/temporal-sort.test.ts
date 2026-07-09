/**
 * Tests for the CLI temporal reorder core (packages/cli/src/lib/temporal-sort.ts),
 * the twin of packages/server/src/search/ranker.ts's reorderByTemporalProximity.
 *
 * Guards the two BLOCKER-family-1 fixes on the CLI recall path:
 *   1. The reorder is relevance-preserving — a bounded proximity boost layered
 *      on a rank-derived relevance signal, so a substantially-more-relevant row
 *      can't be demoted (and the top hit can't be sliced out) by a closer date.
 *   2. Write-recency (created_at-only rows) does not compete on the proximity
 *      scale with content-anchored (referenced_date/relative_date) rows.
 * Also covers the narrowed classifier that lives in the same module.
 */

import { describe, it, expect } from 'vitest'
import { isTemporalQuery, sortByTemporalProximity } from '../lib/temporal-sort.js'

interface Row extends Record<string, unknown> {
  key: string
  referenced_date?: string | null
  relative_date?: string | null
  created_at?: string | null
}

const iso = (ms: number) => new Date(ms).toISOString()
const DAY = 24 * 60 * 60 * 1000

describe('isTemporalQuery (CLI twin, narrowed classifier)', () => {
  it('does not flag ordinary content queries with bare month / gated keywords', () => {
    expect(isTemporalQuery('what may cause this crash')).toBe(false)
    expect(isTemporalQuery('what do we do after a failed migration')).toBe(false)
    expect(isTemporalQuery("what's our auth pattern")).toBe(false)
    expect(isTemporalQuery('what shipped in July')).toBe(false)
  })

  it('flags genuine temporal questions', () => {
    expect(isTemporalQuery('when did I last deploy')).toBe(true)
    expect(isTemporalQuery('what changed before the March 3 migration')).toBe(true)
    expect(isTemporalQuery('what happened on 2026-07-01')).toBe(true)
  })
})

describe('sortByTemporalProximity — relevance-preserving reorder', () => {
  it('never demotes (or slices out) the top similarity hit for a closer-dated lower hit', () => {
    const rows: Row[] = [
      { key: 'top', referenced_date: iso(Date.now() - 365 * DAY) },
      { key: 'lower-recent', referenced_date: iso(Date.now()) },
    ]
    const sorted = sortByTemporalProximity(rows, 'when did this last happen')
    expect(sorted[0].key).toBe('top')
    // A subsequent slice(0, 1) still keeps the top relevance hit.
    expect(sorted.slice(0, 1).map(r => r.key)).toEqual(['top'])
  })

  it('lets date proximity reorder lower-ranked, near-equal-relevance rows', () => {
    const rows: Row[] = [
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
      { key: 'd', referenced_date: '2026-07-01T00:00:00.000Z' },
    ]
    const sorted = sortByTemporalProximity(rows, 'what happened on 2026-07-01')
    expect(sorted.map(r => r.key)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('does not let write-recency (created_at-only rows) compete on the proximity scale', () => {
    const rows: Row[] = [
      { key: 'relevant-old-write', created_at: iso(Date.now() - 365 * DAY) },
      { key: 'noise-recent-write', created_at: iso(Date.now()) },
    ]
    const sorted = sortByTemporalProximity(rows, 'when did this last happen')
    expect(sorted.map(r => r.key)).toEqual(['relevant-old-write', 'noise-recent-write'])
  })

  it('leaves a non-temporal query in its original (relevance) order', () => {
    const rows: Row[] = [
      { key: 'a', referenced_date: iso(0) },
      { key: 'b', referenced_date: iso(Date.now()) },
    ]
    const sorted = sortByTemporalProximity(rows, "what's our auth pattern")
    expect(sorted.map(r => r.key)).toEqual(['a', 'b'])
  })

  it('returns an empty array unchanged', () => {
    expect(sortByTemporalProximity([], 'when did this happen')).toEqual([])
  })
})
