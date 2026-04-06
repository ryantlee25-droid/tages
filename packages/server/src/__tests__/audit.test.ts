import { describe, it, expect } from 'vitest'
import { auditMemories } from '../audit/memory-auditor'
import type { Memory } from '@tages/shared'

const PROJECT = 'audit-test'

function makeMemory(key: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value: 'test value for auditing',
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

describe('auditMemories — empty project', () => {
  it('returns score 0, all types missing for empty input', () => {
    const result = auditMemories([])
    expect(result.score).toBe(0)
    expect(result.briefCriticalCoverage).toBe(0)
    expect(result.imperativeRatio).toBe(0)
    expect(result.missingTypes.length).toBeGreaterThan(0)
  })

  it('includes all 11 types in missingTypes', () => {
    const result = auditMemories([])
    expect(result.missingTypes).toContain('anti_pattern')
    expect(result.missingTypes).toContain('lesson')
    expect(result.missingTypes).toContain('convention')
    expect(result.missingTypes).toContain('pattern')
    expect(result.missingTypes).toContain('execution')
    expect(result.missingTypes.length).toBe(11)
  })
})

describe('auditMemories — type coverage', () => {
  it('gives 100 brief-critical coverage when all 5 critical types present', () => {
    const memories = [
      makeMemory('ap', { type: 'anti_pattern' }),
      makeMemory('ls', { type: 'lesson' }),
      makeMemory('pt', { type: 'pattern' }),
      makeMemory('ex', { type: 'execution' }),
      makeMemory('cv', { type: 'convention' }),
    ]
    const result = auditMemories(memories)
    expect(result.briefCriticalCoverage).toBe(100)
  })

  it('gives 40 brief-critical coverage for anti_pattern + lesson only', () => {
    const memories = [
      makeMemory('ap', { type: 'anti_pattern' }),
      makeMemory('ls', { type: 'lesson' }),
    ]
    const result = auditMemories(memories)
    expect(result.briefCriticalCoverage).toBe(40)
  })

  it('counts all 11 types correctly when all present', () => {
    const types: Memory['type'][] = [
      'convention', 'decision', 'architecture', 'entity', 'lesson',
      'preference', 'pattern', 'execution', 'operational', 'environment', 'anti_pattern',
    ]
    const memories = types.map((t, i) => makeMemory(`mem-${i}`, { type: t }))
    const result = auditMemories(memories)
    expect(result.missingTypes.length).toBe(0)
    for (const t of types) {
      expect(result.typeCounts[t]).toBe(1)
    }
  })
})

describe('auditMemories — imperative ratio', () => {
  it('returns 1.0 ratio when all imperative-type memories use imperative words', () => {
    const memories = [
      makeMemory('ap1', { type: 'anti_pattern', value: 'NEVER use direct DB calls outside of repositories' }),
      makeMemory('ls1', { type: 'lesson', value: 'ALWAYS wrap Supabase calls with Promise.resolve()' }),
      makeMemory('cv1', { type: 'convention', value: 'MUST export named functions not default exports' }),
    ]
    const result = auditMemories(memories)
    expect(result.imperativeRatio).toBe(1.0)
  })

  it('returns 0.0 ratio when no imperative-type memories use imperative words', () => {
    const memories = [
      makeMemory('ap1', { type: 'anti_pattern', value: 'Direct DB calls outside repositories are bad' }),
      makeMemory('ls1', { type: 'lesson', value: 'Supabase returns PromiseLike not Promise' }),
      makeMemory('cv1', { type: 'convention', value: 'Named exports are preferred over default exports' }),
    ]
    const result = auditMemories(memories)
    expect(result.imperativeRatio).toBe(0.0)
  })

  it('returns 0.5 ratio for mixed imperative and descriptive memories', () => {
    const memories = [
      makeMemory('ap1', { type: 'anti_pattern', value: 'NEVER use direct DB calls' }),
      makeMemory('ls1', { type: 'lesson', value: 'Supabase is slow on cold start' }),
    ]
    const result = auditMemories(memories)
    expect(result.imperativeRatio).toBe(0.5)
  })

  it('returns 0 ratio when no imperative-type memories exist', () => {
    const memories = [
      makeMemory('arch', { type: 'architecture', value: 'layered architecture with repos' }),
    ]
    const result = auditMemories(memories)
    expect(result.imperativeRatio).toBe(0)
  })
})

describe('auditMemories — score weighting', () => {
  it('score is 60% brief coverage + 40% imperative ratio', () => {
    // 2/5 critical types = 40 coverage; 100% imperative ratio
    const memories = [
      makeMemory('ap', { type: 'anti_pattern', value: 'NEVER do this' }),
      makeMemory('ls', { type: 'lesson', value: 'ALWAYS do that' }),
    ]
    const result = auditMemories(memories)
    // briefCriticalCoverage = 40, imperativeRatio = 1.0
    // score = 40*0.6 + 100*0.4 = 24 + 40 = 64
    expect(result.score).toBe(64)
  })
})

describe('auditMemories — suggestions', () => {
  it('suggests adding missing brief-critical types', () => {
    const result = auditMemories([])
    expect(result.suggestions.some(s => s.includes('brief-critical'))).toBe(true)
  })

  it('suggests sharpening when imperative ratio < 0.5', () => {
    const memories = [
      makeMemory('ap1', { type: 'anti_pattern', value: 'Descriptive, not imperative' }),
      makeMemory('ap2', { type: 'anti_pattern', value: 'Also descriptive' }),
    ]
    const result = auditMemories(memories)
    expect(result.suggestions.some(s => s.includes('sharpen'))).toBe(true)
  })

  it('suggests adding more memories when count < 10', () => {
    const memories = [makeMemory('one')]
    const result = auditMemories(memories)
    expect(result.suggestions.some(s => s.includes('10+'))).toBe(true)
  })
})
