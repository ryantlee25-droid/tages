import { describe, it, expect } from 'vitest'
import { computeFieldDiff, formatDiff } from '../diff/field-diff'
import type { Memory } from '@tages/shared'

function baseMemory(overrides: Partial<Memory> = {}): Partial<Memory> {
  return {
    value: 'original value',
    confidence: 0.8,
    type: 'convention',
    source: 'manual',
    status: 'live',
    filePaths: ['src/auth.ts'],
    tags: ['api'],
    conditions: ['when authenticated'],
    ...overrides,
  }
}

describe('computeFieldDiff', () => {
  it('detects value change', () => {
    const old = baseMemory({ value: 'old value' })
    const updated = baseMemory({ value: 'new value' })
    const diffs = computeFieldDiff(old, updated)
    const valueChange = diffs.find(d => d.field === 'value')
    expect(valueChange).toBeDefined()
    expect(valueChange!.changeType).toBe('modified')
    expect(valueChange!.oldValue).toBe('old value')
    expect(valueChange!.newValue).toBe('new value')
  })

  it('detects conditions added', () => {
    const old = baseMemory({ conditions: undefined })
    const updated = baseMemory({ conditions: ['when auth', 'when admin'] })
    const diffs = computeFieldDiff(old, updated)
    const condChange = diffs.find(d => d.field === 'conditions')
    expect(condChange).toBeDefined()
    expect(condChange!.changeType).toBe('added')
  })

  it('detects executionFlow steps changed', () => {
    const old = baseMemory({
      executionFlow: { trigger: 'deploy', steps: ['build', 'test'] },
    })
    const updated = baseMemory({
      executionFlow: { trigger: 'deploy', steps: ['build', 'test', 'deploy'] },
    })
    const diffs = computeFieldDiff(old, updated)
    const flowChange = diffs.find(d => d.field === 'executionFlow')
    expect(flowChange).toBeDefined()
    expect(flowChange!.changeType).toBe('modified')
  })

  it('no changes returns empty array', () => {
    const mem = baseMemory()
    const diffs = computeFieldDiff(mem, { ...mem })
    expect(diffs).toHaveLength(0)
  })

  it('detects nested array diff', () => {
    const old = baseMemory({ tags: ['api', 'backend'] })
    const updated = baseMemory({ tags: ['api', 'frontend'] })
    const diffs = computeFieldDiff(old, updated)
    const tagChange = diffs.find(d => d.field === 'tags')
    expect(tagChange).toBeDefined()
    expect(tagChange!.changeType).toBe('modified')
  })

  it('detects confidence delta', () => {
    const old = baseMemory({ confidence: 0.8 })
    const updated = baseMemory({ confidence: 0.95 })
    const diffs = computeFieldDiff(old, updated)
    const confChange = diffs.find(d => d.field === 'confidence')
    expect(confChange).toBeDefined()
    expect(confChange!.oldValue).toBe(0.8)
    expect(confChange!.newValue).toBe(0.95)
  })

  it('detects field removal', () => {
    const old = baseMemory({ agentName: 'claude' })
    const updated = baseMemory({ agentName: undefined })
    const diffs = computeFieldDiff(old, updated)
    const agentChange = diffs.find(d => d.field === 'agentName')
    expect(agentChange).toBeDefined()
    expect(agentChange!.changeType).toBe('removed')
  })

  it('does not report unchanged fields', () => {
    const old = baseMemory({ value: 'same', type: 'convention', confidence: 1.0 })
    const updated = baseMemory({ value: 'same', type: 'convention', confidence: 1.0 })
    const diffs = computeFieldDiff(old, updated)
    expect(diffs).toHaveLength(0)
  })
})

describe('formatDiff', () => {
  it('returns "(no changes)" for empty diff array', () => {
    expect(formatDiff([])).toBe('(no changes)')
  })

  it('formats confidence delta with percentage', () => {
    const diffs = computeFieldDiff(
      baseMemory({ confidence: 0.5 }),
      baseMemory({ confidence: 0.8 }),
    )
    const formatted = formatDiff(diffs)
    expect(formatted).toContain('confidence')
    expect(formatted).toContain('%')
    expect(formatted).toContain('+')
  })

  it('formats added field with + prefix', () => {
    const diffs = computeFieldDiff(
      baseMemory({ conditions: undefined }),
      baseMemory({ conditions: ['when auth'] }),
    )
    const formatted = formatDiff(diffs)
    expect(formatted).toContain('+')
    expect(formatted).toContain('conditions')
  })

  it('formats removed field with - prefix', () => {
    const diffs = computeFieldDiff(
      baseMemory({ tags: ['api'] }),
      baseMemory({ tags: undefined }),
    )
    const formatted = formatDiff(diffs)
    expect(formatted).toContain('-')
    expect(formatted).toContain('tags')
  })
})
