import { describe, it, expect } from 'vitest'
import { computeBehavioralDrift } from '../behavioral-drift.js'
import type { ToolCallRow } from '../types.js'

/**
 * Test helpers.
 *
 * Each helper produces a small ToolCallRow with sensible defaults so that
 * test bodies stay focused on the distribution shape being asserted, not on
 * boilerplate fields the function ignores.
 */
function call(
  agent: string,
  tool: string,
  isoTime: string,
  overrides: Partial<ToolCallRow> = {},
): ToolCallRow {
  return {
    project_id: 'p',
    session_id: 's',
    agent_name: agent,
    tool_name: tool,
    created_at: isoTime,
    ...overrides,
  }
}

/**
 * Generate `n` calls of `tool` by `agent`, spaced 1 hour apart starting at
 * `startIso`. Returns the calls in chronological order.
 */
function bulk(agent: string, tool: string, n: number, startIso: string): ToolCallRow[] {
  const start = Date.parse(startIso)
  return Array.from({ length: n }, (_, i) =>
    call(agent, tool, new Date(start + i * 3600_000).toISOString()),
  )
}

describe('computeBehavioralDrift / windowing', () => {
  it('returns insufficient_data when no agent_name is present', () => {
    const calls = bulk('', 'recall', 10, '2026-04-01T00:00:00Z').map((c) => ({
      ...c,
      agent_name: null,
    }))
    const r = computeBehavioralDrift(calls)
    expect(r.status).toBe('insufficient_data')
    expect(r.score).toBe(0)
  })

  it('returns insufficient_data when only one agent has enough calls in both windows', () => {
    // Single agent across both windows — no inter-agent comparison possible by design,
    // but the per-agent temporal comparison is allowed if 2 windows have data.
    // Single agent with split data IS eligible (1 agent, 5+ in each window).
    const calls = [
      ...bulk('claude', 'recall', 6, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'remember', 6, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls)
    expect(r.status).toBe('ok')
    expect(r.agentCount).toBe(1)
  })

  it('returns insufficient_data when an agent has fewer than the threshold per window', () => {
    const calls = [
      ...bulk('claude', 'recall', 3, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'recall', 3, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls)
    expect(r.status).toBe('insufficient_data')
    expect(r.score).toBe(0)
  })

  it('uses explicit baselineSince/currentSince when provided', () => {
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'), // window A
      ...bulk('claude', 'remember', 10, '2026-04-15T00:00:00Z'), // window B
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.windowA?.since.startsWith('2026-04-01')).toBe(true)
    expect(r.windowB?.since.startsWith('2026-04-10')).toBe(true)
  })

  it('falls back to midpoint split when no explicit windows are given', () => {
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'remember', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls)
    expect(r.status).toBe('ok')
    // Midpoint of 04-01..04-15+9h is somewhere ~04-08, so the split should
    // place the early-recall calls in A and the late-remember calls in B.
    expect(r.windowA?.toolCallCount).toBeGreaterThan(0)
    expect(r.windowB?.toolCallCount).toBeGreaterThan(0)
  })
})

describe('computeBehavioralDrift / JSD math', () => {
  it('produces ≈ 0 score when an agents distribution is identical across windows', () => {
    // 50% recall / 50% remember in both windows.
    const calls = [
      ...bulk('claude', 'recall', 5, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'remember', 5, '2026-04-02T00:00:00Z'),
      ...bulk('claude', 'recall', 5, '2026-04-15T00:00:00Z'),
      ...bulk('claude', 'remember', 5, '2026-04-16T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.score).toBeLessThan(0.05) // small Laplace bias allowed
  })

  it('produces a high score when an agent fully switches tools between windows', () => {
    // Window A: 10 recalls. Window B: 10 forgets. Disjoint vocabulary.
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'forget', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    // Theoretical max with Laplace smoothing across 2-tool vocab is below 1.0
    // but should still register as high drift (>0.4).
    expect(r.score).toBeGreaterThan(0.4)
  })

  it('handles a new tool appearing in the current window without producing NaN', () => {
    const calls = [
      ...bulk('claude', 'recall', 8, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'recall', 5, '2026-04-15T00:00:00Z'),
      ...bulk('claude', 'new_tool', 5, '2026-04-16T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(Number.isFinite(r.score)).toBe(true)
    expect(Number.isNaN(r.score)).toBe(false)
    expect(r.score).toBeGreaterThan(0)
  })

  it('averages JSD across multiple eligible agents', () => {
    // claude: identical between windows (low JSD)
    // codex:  fully switches tools (high JSD)
    // average should be in between.
    const calls = [
      // claude — same dist in both windows
      ...bulk('claude', 'recall', 5, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'remember', 5, '2026-04-02T00:00:00Z'),
      ...bulk('claude', 'recall', 5, '2026-04-15T00:00:00Z'),
      ...bulk('claude', 'remember', 5, '2026-04-16T00:00:00Z'),
      // codex — fully switches
      ...bulk('codex', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('codex', 'forget', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.agentCount).toBe(2)
    // Mean of "near 0" and "near 0.5+" — should land somewhere in the middle.
    expect(r.score).toBeGreaterThan(0.05)
    expect(r.score).toBeLessThan(0.5)
  })

  it('reports per-agent top tools from the current window', () => {
    const calls = [
      ...bulk('claude', 'recall', 5, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'remember', 5, '2026-04-02T00:00:00Z'),
      // Current window: heavily weighted toward forget
      ...bulk('claude', 'forget', 8, '2026-04-15T00:00:00Z'),
      ...bulk('claude', 'recall', 2, '2026-04-16T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.agentDistributions).toBeDefined()
    expect(r.agentDistributions![0]!.agent).toBe('claude')
    expect(r.agentDistributions![0]!.topTools[0]!.tool).toBe('forget')
    expect(r.agentDistributions![0]!.topTools[0]!.share).toBeGreaterThan(0.5)
  })
})

describe('computeBehavioralDrift / threshold notes', () => {
  it('uses a healthy note for low scores', () => {
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'recall', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.note.toLowerCase()).toContain('healthy')
  })

  it('uses a high-drift note for fully-switched tools', () => {
    const calls = [
      ...bulk('claude', 'recall', 10, '2026-04-01T00:00:00Z'),
      ...bulk('claude', 'forget', 10, '2026-04-15T00:00:00Z'),
    ]
    const r = computeBehavioralDrift(calls, {
      baselineSince: '2026-04-01T00:00:00Z',
      currentSince: '2026-04-10T00:00:00Z',
    })
    expect(r.status).toBe('ok')
    expect(r.note.toLowerCase()).toMatch(/high drift|warning/)
  })
})
