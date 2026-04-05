import { describe, it, expect } from 'vitest'
import { computeDecayScore, shouldArchive, getTypeDecayRate } from '../decay/scoring'
import type { Memory } from '@tages/shared'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    projectId: 'proj-1',
    key: 'test',
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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('computeDecayScore', () => {
  it('fresh memory (just created) has no decay', () => {
    const mem = makeMemory({ updatedAt: new Date().toISOString() })
    const score = computeDecayScore(mem, {})
    expect(score).toBe(0)
  })

  it('memory within grace period has no decay', () => {
    const mem = makeMemory({ updatedAt: daysAgo(15) })
    const score = computeDecayScore(mem, {})
    expect(score).toBe(0)
  })

  it('old unaccessed memory has significant decay score', () => {
    // Use 'preference' type which has rate 1.2 (decays faster) to ensure score > 0.5
    const mem = makeMemory({ type: 'preference', updatedAt: daysAgo(180) })
    const score = computeDecayScore(mem, { accessCount: 0 })
    expect(score).toBeGreaterThan(0.5)
  })

  it('frequently accessed memory has lower decay than unaccessed', () => {
    const mem = makeMemory({ updatedAt: daysAgo(90) })
    const highAccessScore = computeDecayScore(mem, { accessCount: 20 })
    const lowAccessScore = computeDecayScore(mem, { accessCount: 0 })
    expect(highAccessScore).toBeLessThan(lowAccessScore)
  })

  it('decay resets on access: recently accessed old memory has lower score', () => {
    const mem = makeMemory({ updatedAt: daysAgo(200) })
    const withRecentAccess = computeDecayScore(mem, { lastAccessedAt: daysAgo(5), accessCount: 5 })
    const withNoAccess = computeDecayScore(mem, { accessCount: 0 })
    expect(withRecentAccess).toBeLessThan(withNoAccess)
  })

  it('archive threshold: shouldArchive returns true above threshold', () => {
    expect(shouldArchive(0.85)).toBe(true)
    expect(shouldArchive(0.79)).toBe(false)
  })

  it('type-specific decay rates: convention decays slower than preference', () => {
    const now = new Date()
    const convention = makeMemory({ type: 'convention', updatedAt: daysAgo(100) })
    const preference = makeMemory({ type: 'preference', updatedAt: daysAgo(100) })
    const convScore = computeDecayScore(convention, {}, {}, now)
    const prefScore = computeDecayScore(preference, {}, {}, now)
    expect(convScore).toBeLessThan(prefScore)
  })

  it('architecture decays slower than execution', () => {
    const arch = makeMemory({ type: 'architecture', updatedAt: daysAgo(120) })
    const exec = makeMemory({ type: 'execution', updatedAt: daysAgo(120) })
    const archScore = computeDecayScore(arch, {})
    const execScore = computeDecayScore(exec, {})
    expect(archScore).toBeLessThan(execScore)
  })

  it('score is bounded between 0 and 1', () => {
    const ancient = makeMemory({ updatedAt: daysAgo(1000) })
    const score = computeDecayScore(ancient, { accessCount: 0 })
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('custom decay config overrides defaults', () => {
    const mem = makeMemory({ updatedAt: daysAgo(60) })
    // Very short grace period so decay kicks in earlier
    const scoreDefault = computeDecayScore(mem, {})
    const scoreCustom = computeDecayScore(mem, {}, { gracePeriodDays: 5, halfLifeDays: 30 })
    // Custom config decays faster so score should be higher
    expect(scoreCustom).toBeGreaterThan(scoreDefault)
  })
})

describe('shouldArchive', () => {
  it('returns false for score below threshold', () => {
    expect(shouldArchive(0.5)).toBe(false)
  })

  it('returns true for score at or above threshold', () => {
    expect(shouldArchive(0.8)).toBe(true)
    expect(shouldArchive(1.0)).toBe(true)
  })

  it('uses custom threshold', () => {
    expect(shouldArchive(0.6, 0.5)).toBe(true)
    expect(shouldArchive(0.6, 0.7)).toBe(false)
  })
})

describe('getTypeDecayRate', () => {
  it('conventions decay slower (rate < 1)', () => {
    expect(getTypeDecayRate('convention')).toBeLessThan(1.0)
  })

  it('preferences decay faster (rate > 1)', () => {
    expect(getTypeDecayRate('preference')).toBeGreaterThan(1.0)
  })
})
