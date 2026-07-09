import { describe, it, expect } from 'vitest'
import { isTemporalQuery, extractTargetDate } from '../search/temporal-query'

const ANCHOR = new Date('2026-07-08T12:00:00.000Z') // Wednesday

describe('isTemporalQuery', () => {
  it('flags "when" queries', () => {
    expect(isTemporalQuery('when did I last deploy')).toBe(true)
  })

  it('flags "before"/"after" ONLY when a temporal referent co-occurs', () => {
    // Bare "before"/"after" on an ordinary content query is NOT temporal
    // (narrowed classifier — these used to fire on the bare keyword).
    expect(isTemporalQuery('what happened before the migration')).toBe(false)
    expect(isTemporalQuery('what changed after the outage')).toBe(false)
    // With a concrete referent (a dated month, a weekday) they ARE temporal.
    expect(isTemporalQuery('what changed before the March 3 migration')).toBe(true)
    expect(isTemporalQuery('what shipped after last Tuesday')).toBe(true)
  })

  it('flags "last time" queries', () => {
    expect(isTemporalQuery('what was the last time we deployed')).toBe(true)
  })

  it('flags "ago" queries', () => {
    expect(isTemporalQuery('what did we ship 3 days ago')).toBe(true)
  })

  it('flags queries naming a weekday', () => {
    expect(isTemporalQuery('what did I do on Tuesday')).toBe(true)
  })

  it('flags a month name only with date-like context, not bare', () => {
    // Bare month word is NOT temporal (it collides with the modal "may" and
    // with ordinary prose): "what may cause this crash", "what shipped in July".
    expect(isTemporalQuery('what shipped in July')).toBe(false)
    expect(isTemporalQuery('what may cause this crash')).toBe(false)
    // A month WITH a day or year IS temporal.
    expect(isTemporalQuery('what shipped on July 4 2026')).toBe(true)
    expect(isTemporalQuery('what changed in March 2026')).toBe(true)
  })

  it('does not flag ordinary content queries that merely contain gated keywords', () => {
    // The three invariant cases the review called out.
    expect(isTemporalQuery('what may cause this crash')).toBe(false)
    expect(isTemporalQuery('what do we do after a failed migration')).toBe(false)
    expect(isTemporalQuery("what's our auth pattern")).toBe(false)
  })

  it('flags genuine temporal questions the narrowed classifier must still catch', () => {
    expect(isTemporalQuery('when did I last deploy')).toBe(true)
    expect(isTemporalQuery('what changed before the March 3 migration')).toBe(true)
  })

  it('flags queries with an explicit ISO date', () => {
    expect(isTemporalQuery('what happened on 2026-07-01')).toBe(true)
  })

  it('flags queries with an explicit MM/DD/YYYY date', () => {
    expect(isTemporalQuery('what happened on 07/01/2026')).toBe(true)
  })

  it('does not flag ordinary content queries', () => {
    expect(isTemporalQuery("what's our auth pattern")).toBe(false)
  })

  it('does not flag unrelated content queries', () => {
    expect(isTemporalQuery('how does the ranker weight semantic scores')).toBe(false)
  })

  it('returns false for an empty query', () => {
    expect(isTemporalQuery('')).toBe(false)
  })
})

describe('extractTargetDate', () => {
  it('resolves an explicit date named in the query', () => {
    const target = extractTargetDate('what happened on 2026-07-01', ANCHOR)
    expect(target?.toISOString()).toBe(new Date('2026-07-01T00:00:00.000Z').toISOString())
  })

  it('resolves a relative expression named in the query', () => {
    const target = extractTargetDate('what did we ship 3 days ago', ANCHOR)
    expect(target?.toISOString()).toBe(new Date('2026-07-05T12:00:00.000Z').toISOString())
  })

  it('returns undefined for a temporal query with no extractable date', () => {
    const target = extractTargetDate('when did I last deploy', ANCHOR)
    expect(target).toBeUndefined()
  })
})
