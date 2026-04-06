import { describe, it, expect } from 'vitest'
import type { Memory } from '@tages/shared'
import { estimateTokens, budgetedResults } from '../search/token-budget'

function makeMemory(key: string, value: string): Memory {
  return {
    id: `test-${key}`,
    projectId: 'proj-1',
    key,
    value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as Memory
}

const formatFn = (m: Memory): string => `[${m.type}] ${m.key}\n   ${m.value}`

describe('estimateTokens', () => {
  it('returns correct estimate for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns correct estimate for short text', () => {
    // "test" = 4 chars => 1 token
    expect(estimateTokens('test')).toBe(1)
  })

  it('rounds up for non-multiples of 4', () => {
    // "hello" = 5 chars => ceil(5/4) = 2 tokens
    expect(estimateTokens('hello')).toBe(2)
  })

  it('returns correct estimate for longer text', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })
})

describe('budgetedResults', () => {
  const memories = [
    makeMemory('key-a', 'short value'),
    makeMemory('key-b', 'another short value here'),
    makeMemory('key-c', 'third memory value content'),
  ]

  it('returns all memories when budget is large', () => {
    const result = budgetedResults(memories, 100_000, formatFn)
    expect(result).toHaveLength(3)
  })

  it('truncates when budget is exceeded', () => {
    // Estimate first memory size
    const firstFormatted = formatFn(memories[0])
    const firstTokens = estimateTokens(firstFormatted)
    // Set budget to fit only 1 memory
    const result = budgetedResults(memories, firstTokens, formatFn)
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('key-a')
  })

  it('returns empty array when budget is too small for even one memory', () => {
    // Budget of 1 token = 4 chars, not enough for any memory
    const result = budgetedResults(memories, 1, formatFn)
    expect(result).toHaveLength(0)
  })

  it('returns memories in order (first fit first)', () => {
    const result = budgetedResults(memories, 100_000, formatFn)
    expect(result[0].key).toBe('key-a')
    expect(result[1].key).toBe('key-b')
    expect(result[2].key).toBe('key-c')
  })

  it('handles empty input array', () => {
    const result = budgetedResults([], 1000, formatFn)
    expect(result).toHaveLength(0)
  })
})
