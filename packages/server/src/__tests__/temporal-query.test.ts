import { describe, it, expect } from 'vitest'
import { isTemporalQuery, extractTargetDate } from '../search/temporal-query'

const ANCHOR = new Date('2026-07-08T12:00:00.000Z') // Wednesday

describe('isTemporalQuery', () => {
  it('flags "when" queries', () => {
    expect(isTemporalQuery('when did I last deploy')).toBe(true)
  })

  it('flags "before"/"after" queries', () => {
    expect(isTemporalQuery('what happened before the migration')).toBe(true)
    expect(isTemporalQuery('what changed after the outage')).toBe(true)
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

  it('flags queries naming a month', () => {
    expect(isTemporalQuery('what shipped in July')).toBe(true)
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
