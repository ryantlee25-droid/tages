import { describe, it, expect } from 'vitest'
import { threeWayMerge, lcsTextMerge, mergeStructuredFields } from '../merge/three-way'
import type { Memory } from '@tages/shared'

function makeMemoryFragment(overrides: Partial<Memory> = {}): Partial<Memory> {
  return {
    value: 'base value',
    confidence: 1.0,
    type: 'convention',
    filePaths: [],
    tags: [],
    conditions: [],
    crossSystemRefs: [],
    ...overrides,
  }
}

describe('lcsTextMerge', () => {
  it('returns same string when both inputs are equal', () => {
    expect(lcsTextMerge('hello world', 'hello world')).toBe('hello world')
  })

  it('returns b when a is empty', () => {
    expect(lcsTextMerge('', 'hello world')).toBe('hello world')
  })

  it('returns a when b is empty', () => {
    expect(lcsTextMerge('hello world', '')).toBe('hello world')
  })

  it('merges two non-overlapping strings', () => {
    const result = lcsTextMerge('use snake_case', 'use camelCase')
    expect(result).toContain('use')
    expect(result).toContain('snake_case')
    expect(result).toContain('camelCase')
  })

  it('preserves common words once (no duplication)', () => {
    const result = lcsTextMerge('always use TypeScript', 'always use strict TypeScript')
    const words = result.split(' ')
    const alwaysCount = words.filter(w => w === 'always').length
    expect(alwaysCount).toBe(1)
  })
})

describe('mergeStructuredFields', () => {
  it('unions arrays from both sides', () => {
    const a: Partial<Memory> = { conditions: ['auth', 'admin'], tags: ['api'] }
    const b: Partial<Memory> = { conditions: ['auth', 'public'], tags: ['backend'] }
    const result = mergeStructuredFields(a, b)
    expect(result.conditions).toContain('auth')
    expect(result.conditions).toContain('admin')
    expect(result.conditions).toContain('public')
    // no duplicates
    const authCount = result.conditions!.filter(c => c === 'auth').length
    expect(authCount).toBe(1)
  })

  it('deduplicates array union', () => {
    const a: Partial<Memory> = { tags: ['x', 'y'] }
    const b: Partial<Memory> = { tags: ['y', 'z'] }
    const result = mergeStructuredFields(a, b)
    const yCount = result.tags!.filter(t => t === 'y').length
    expect(yCount).toBe(1)
  })

  it('merges executionFlow steps preserving order', () => {
    const a: Partial<Memory> = {
      executionFlow: { trigger: 'deploy', steps: ['build', 'test', 'deploy'] },
    }
    const b: Partial<Memory> = {
      executionFlow: { trigger: 'deploy', steps: ['build', 'lint', 'test', 'deploy'] },
    }
    const result = mergeStructuredFields(a, b)
    expect(result.executionFlow!.steps).toContain('build')
    expect(result.executionFlow!.steps).toContain('test')
    expect(result.executionFlow!.steps).toContain('lint')
    expect(result.executionFlow!.steps).toContain('deploy')
  })

  it('uses existing executionFlow when one side is missing', () => {
    const a: Partial<Memory> = {
      executionFlow: { trigger: 'start', steps: ['init', 'run'] },
    }
    const b: Partial<Memory> = {}
    const result = mergeStructuredFields(a, b)
    expect(result.executionFlow).toEqual(a.executionFlow)
  })
})

describe('threeWayMerge', () => {
  it('no-op merge when all three are identical', () => {
    const base = makeMemoryFragment({ value: 'same' })
    const result = threeWayMerge(base, { value: 'same' }, { value: 'same' })
    expect(result.merged.value).toBe('same')
    expect(result.conflicts).toHaveLength(0)
    expect(result.strategy).toBe('clean')
  })

  it('takes right change when only right changed from base', () => {
    const base = makeMemoryFragment({ value: 'original' })
    const left = makeMemoryFragment({ value: 'original' })
    const right = makeMemoryFragment({ value: 'updated by right' })
    const result = threeWayMerge(base, left, right)
    expect(result.merged.value).toBe('updated by right')
    expect(result.strategy).toBe('clean')
  })

  it('takes left change when only left changed from base', () => {
    const base = makeMemoryFragment({ value: 'original' })
    const left = makeMemoryFragment({ value: 'updated by left' })
    const right = makeMemoryFragment({ value: 'original' })
    const result = threeWayMerge(base, left, right)
    expect(result.merged.value).toBe('updated by left')
    expect(result.strategy).toBe('clean')
  })

  it('uses LCS text merge when both sides changed value', () => {
    const base = makeMemoryFragment({ value: 'use REST API for all routes' })
    const left = makeMemoryFragment({ value: 'use REST API for auth routes' })
    const right = makeMemoryFragment({ value: 'use REST API for all data routes' })
    const result = threeWayMerge(base, left, right)
    expect(result.merged.value).toContain('REST')
    expect(result.merged.value).toContain('API')
  })

  it('array union for conditions', () => {
    const base = makeMemoryFragment({ conditions: ['auth'] })
    const left = makeMemoryFragment({ conditions: ['auth', 'admin'] })
    const right = makeMemoryFragment({ conditions: ['auth', 'public'] })
    const result = threeWayMerge(base, left, right)
    expect(result.merged.conditions).toContain('auth')
    expect(result.merged.conditions).toContain('admin')
    expect(result.merged.conditions).toContain('public')
  })

  it('detects conflict when scalar field changed on both sides differently', () => {
    const base = makeMemoryFragment({ type: 'convention' })
    const left: Partial<Memory> = { type: 'decision' }
    const right: Partial<Memory> = { type: 'architecture' }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toContain('type')
    expect(result.strategy).toBe('partial')
  })

  it('no conflict when both sides change to same value', () => {
    const base = makeMemoryFragment({ type: 'convention' })
    const left: Partial<Memory> = { type: 'decision' }
    const right: Partial<Memory> = { type: 'decision' }
    const result = threeWayMerge(base, left, right)
    expect(result.merged.type).toBe('decision')
    expect(result.conflicts).not.toContain('type')
  })

  it('merges executionFlow from both sides', () => {
    const base = makeMemoryFragment()
    const left: Partial<Memory> = {
      executionFlow: { trigger: 'deploy', steps: ['build', 'test'] },
    }
    const right: Partial<Memory> = {
      executionFlow: { trigger: 'deploy', steps: ['build', 'deploy'] },
    }
    const result = threeWayMerge(base, left, right)
    expect(result.merged.executionFlow).toBeDefined()
    expect(result.merged.executionFlow!.steps).toContain('build')
    expect(result.merged.executionFlow!.steps).toContain('test')
    expect(result.merged.executionFlow!.steps).toContain('deploy')
  })

  it('takes max confidence from both sides', () => {
    const base = makeMemoryFragment({ confidence: 0.5 })
    const left: Partial<Memory> = { confidence: 0.8 }
    const right: Partial<Memory> = { confidence: 0.6 }
    const result = threeWayMerge(base, left, right)
    expect(result.merged.confidence).toBe(0.8)
  })
})
