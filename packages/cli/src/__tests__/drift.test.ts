import { describe, it, expect } from 'vitest'
import { resolveSince } from '../commands/drift.js'

describe('resolveSince', () => {
  it('returns undefined for undefined input', () => {
    expect(resolveSince(undefined)).toBeUndefined()
  })

  it('parses Nd as N days ago', () => {
    const before = Date.now()
    const iso = resolveSince('7d')!
    const ts = new Date(iso).getTime()
    const expected = before - 7 * 86_400_000
    // Allow a small tolerance for the clock read between before and resolveSince
    expect(Math.abs(ts - expected)).toBeLessThan(1000)
  })

  it('parses Nh as N hours ago', () => {
    const before = Date.now()
    const iso = resolveSince('2h')!
    const ts = new Date(iso).getTime()
    const expected = before - 2 * 3_600_000
    expect(Math.abs(ts - expected)).toBeLessThan(1000)
  })

  it('accepts an ISO timestamp', () => {
    const input = '2026-04-01T00:00:00.000Z'
    expect(resolveSince(input)).toBe(input)
  })

  it('throws on unrecognized input', () => {
    expect(() => resolveSince('last tuesday')).toThrow(/Unrecognized --since value/)
  })

  it('rejects mixed units', () => {
    expect(() => resolveSince('7dx')).toThrow(/Unrecognized --since value/)
  })

  it('parses --baseline-since and --current-since values the same way', () => {
    // Behavioral-drift CLI accepts the same Nd / Nh / ISO grammar via
    // resolveSince. A cross-check that the parser is reused unchanged.
    const baseline = resolveSince('14d')
    const current = resolveSince('7d')
    expect(baseline).toBeDefined()
    expect(current).toBeDefined()
    // baseline is older than current (further back)
    expect(new Date(baseline!).getTime()).toBeLessThan(new Date(current!).getTime())
  })
})
