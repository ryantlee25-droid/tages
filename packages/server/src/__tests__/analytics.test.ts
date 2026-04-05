import { describe, it, expect, beforeEach } from 'vitest'
import { SessionRecorder } from '../analytics/session-recorder'
import { computeAgentMetrics } from '../analytics/metrics-computer'
import { computeTrends } from '../analytics/trend-analyzer'
import type { SessionRecord } from '../analytics/session-recorder'

const PROJECT = 'analytics-test'

function makeSession(
  id: string,
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    sessionId: id,
    projectId: PROJECT,
    agentName: 'test-agent',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    toolCalls: [],
    metrics: {
      totalCalls: 10,
      recallHits: 7,
      recallMisses: 3,
      memoriesCreated: 2,
      memoriesUpdated: 1,
      conventionViolations: 0,
      durationMs: 5000,
      recallHitRate: 0.7,
      createToVerifyRatio: 2,
    },
    ...overrides,
  }
}

describe('SessionRecorder', () => {
  let recorder: SessionRecorder

  beforeEach(() => {
    recorder = new SessionRecorder()
  })

  it('starts and tracks a session', () => {
    recorder.startSession('s1', PROJECT, 'agent-1')
    expect(recorder.getCurrentSessionId()).toBe('s1')
    const session = recorder.getSession('s1')
    expect(session?.agentName).toBe('agent-1')
  })

  it('records tool calls', () => {
    recorder.startSession('s2', PROJECT)
    recorder.recordToolCall('s2', 'recall', { query: 'auth' }, 'Found 3 memories', 12)
    const session = recorder.getSession('s2')
    expect(session?.toolCalls.length).toBe(1)
    expect(session?.toolCalls[0].toolName).toBe('recall')
    expect(session?.toolCalls[0].durationMs).toBe(12)
  })

  it('ends session and computes metrics', () => {
    recorder.startSession('s3', PROJECT)
    recorder.recordToolCall('s3', 'recall', { query: 'test' }, 'Found 2 memories for "test"', 10)
    recorder.recordToolCall('s3', 'recall', { query: 'other' }, 'No memories found matching "other".', 5)
    recorder.recordToolCall('s3', 'remember', { key: 'k' }, 'Stored memory: "k"', 15)
    const session = recorder.endSession('s3')
    expect(session?.metrics?.recallHits).toBe(1)
    expect(session?.metrics?.recallMisses).toBe(1)
    expect(session?.metrics?.memoriesCreated).toBe(1)
    expect(session?.metrics?.recallHitRate).toBe(0.5)
  })

  it('handles empty session gracefully', () => {
    recorder.startSession('s4', PROJECT)
    const session = recorder.endSession('s4')
    expect(session?.metrics?.totalCalls).toBe(0)
    expect(session?.metrics?.recallHitRate).toBe(0)
  })

  it('returns null for unknown session', () => {
    expect(recorder.getSession('nonexistent')).toBeNull()
  })

  it('getAllSessions filters by projectId', () => {
    recorder.startSession('a1', PROJECT)
    recorder.startSession('b1', 'other-project')
    const sessions = recorder.getAllSessions(PROJECT)
    expect(sessions.length).toBe(1)
    expect(sessions[0].sessionId).toBe('a1')
  })

  it('clears currentSessionId on end', () => {
    recorder.startSession('s5', PROJECT)
    recorder.endSession('s5')
    expect(recorder.getCurrentSessionId()).toBeNull()
  })

  it('records multiple tool calls in order', () => {
    recorder.startSession('s6', PROJECT)
    recorder.recordToolCall('s6', 'recall', {}, 'Found 1 memory', 5)
    recorder.recordToolCall('s6', 'remember', {}, 'Stored memory: "x"', 10)
    recorder.recordToolCall('s6', 'recall', {}, 'No memories found', 3)
    const session = recorder.getSession('s6')!
    expect(session.toolCalls[0].toolName).toBe('recall')
    expect(session.toolCalls[1].toolName).toBe('remember')
    expect(session.toolCalls[2].toolName).toBe('recall')
  })
})

describe('computeAgentMetrics', () => {
  it('computes correct averages', () => {
    const sessions = [
      makeSession('a', { metrics: { ...makeSession('a').metrics!, recallHitRate: 0.8, memoriesCreated: 5, conventionViolations: 0, totalCalls: 10, durationMs: 6000, recallHits: 8, recallMisses: 2, memoriesUpdated: 0, createToVerifyRatio: 5 } }),
      makeSession('b', { metrics: { ...makeSession('b').metrics!, recallHitRate: 0.6, memoriesCreated: 3, conventionViolations: 2, totalCalls: 8, durationMs: 4000, recallHits: 5, recallMisses: 3, memoriesUpdated: 1, createToVerifyRatio: 3 } }),
    ]
    const metrics = computeAgentMetrics(sessions, 'test-agent')
    expect(metrics.avgRecallHitRate).toBeCloseTo(0.7, 1)
    expect(metrics.totalMemoriesCreated).toBe(8)
    expect(metrics.totalConventionViolations).toBe(2)
  })

  it('returns zero metrics for empty sessions', () => {
    const metrics = computeAgentMetrics([], 'ghost-agent')
    expect(metrics.overallScore).toBe(0)
    expect(metrics.sessionCount).toBe(0)
  })

  it('filters by agent name', () => {
    const sessions = [
      makeSession('a', { agentName: 'agent-a' }),
      makeSession('b', { agentName: 'agent-b' }),
    ]
    const metrics = computeAgentMetrics(sessions, 'agent-a')
    expect(metrics.sessionCount).toBe(1)
  })

  it('computes overall score in 0-100 range', () => {
    const sessions = [makeSession('s')]
    const metrics = computeAgentMetrics(sessions)
    expect(metrics.overallScore).toBeGreaterThanOrEqual(0)
    expect(metrics.overallScore).toBeLessThanOrEqual(100)
  })
})

describe('computeTrends', () => {
  it('returns stable insight with no change', () => {
    const sessions = [
      makeSession('a', { startedAt: new Date(Date.now() - 2000).toISOString() }),
      makeSession('b', { startedAt: new Date(Date.now() - 1000).toISOString() }),
    ]
    const report = computeTrends(sessions)
    expect(report.sessions).toBe(2)
    expect(report.insights.length).toBeGreaterThan(0)
  })

  it('returns not-enough-sessions for single session', () => {
    const sessions = [makeSession('a')]
    const report = computeTrends(sessions)
    expect(report.insights[0]).toContain('Not enough')
  })

  it('detects improving recall', () => {
    const now = Date.now()
    const old = makeSession('a', {
      startedAt: new Date(now - 5000).toISOString(),
      metrics: { ...makeSession('a').metrics!, recallHitRate: 0.3, recallHits: 3, recallMisses: 7, totalCalls: 10, memoriesCreated: 1, memoriesUpdated: 0, conventionViolations: 0, durationMs: 3000, createToVerifyRatio: 1 },
    })
    const current = makeSession('b', {
      startedAt: new Date(now).toISOString(),
      metrics: { ...makeSession('b').metrics!, recallHitRate: 0.9, recallHits: 9, recallMisses: 1, totalCalls: 10, memoriesCreated: 1, memoriesUpdated: 0, conventionViolations: 0, durationMs: 3000, createToVerifyRatio: 1 },
    })
    const report = computeTrends([old, current])
    expect(report.recallHitRateTrend).toBeGreaterThan(0)
    expect(report.insights.some(i => i.includes('improved') || i.includes('Recall'))).toBe(true)
  })

  it('filters trends by agent name', () => {
    const sessions = [
      makeSession('a', { agentName: 'agent-a', startedAt: new Date(Date.now() - 2000).toISOString() }),
      makeSession('b', { agentName: 'agent-a', startedAt: new Date(Date.now() - 1000).toISOString() }),
      makeSession('c', { agentName: 'agent-b', startedAt: new Date().toISOString() }),
    ]
    const report = computeTrends(sessions, 'agent-a')
    expect(report.sessions).toBe(2)
  })
})
