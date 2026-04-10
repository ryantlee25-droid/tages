import { describe, it, expect, vi, afterEach } from 'vitest'
import { shouldHydrate } from '../hydration'

describe('shouldHydrate()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns true when lastSync is null (no prior sync)', () => {
    expect(shouldHydrate(null)).toBe(true)
  })

  it('returns true when lastSync is older than 60s', () => {
    const old = new Date(Date.now() - 61_000).toISOString()
    expect(shouldHydrate(old)).toBe(true)
  })

  it('returns true when lastSync is exactly 60s ago (boundary: >= ttl)', () => {
    const exact = new Date(Date.now() - 60_000).toISOString()
    expect(shouldHydrate(exact)).toBe(true)
  })

  it('returns false when lastSync is 59s ago (cache is fresh)', () => {
    const fresh = new Date(Date.now() - 59_000).toISOString()
    expect(shouldHydrate(fresh)).toBe(false)
  })

  it('returns false when lastSync is 1ms ago (very fresh)', () => {
    const veryFresh = new Date(Date.now() - 1).toISOString()
    expect(shouldHydrate(veryFresh)).toBe(false)
  })

  it('accepts custom ttlMs override', () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
    // With 5s TTL, 10s ago is stale
    expect(shouldHydrate(tenSecondsAgo, 5_000)).toBe(true)
    // With 15s TTL, 10s ago is fresh
    expect(shouldHydrate(tenSecondsAgo, 15_000)).toBe(false)
  })

  it('handles ISO 8601 string with timezone correctly', () => {
    const recent = new Date(Date.now() - 5_000).toISOString()
    expect(shouldHydrate(recent)).toBe(false)
  })
})
