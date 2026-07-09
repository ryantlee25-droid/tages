import { describe, it, expect, vi } from 'vitest'
import type { RunResult } from './types.js'

// buildResult calls computeOracleSha(), which reads the (gitignored, not
// downloaded in this environment) oracle dataset file off disk. Mock it so
// these are pure unit tests of the aggregation logic, independent of dataset
// presence.
vi.mock('./dataset.js', () => ({
  computeOracleSha: () => 'test-sha',
  loadOracle: () => [],
  stratifiedSample: () => [],
}))

const { parseSessionId, computeRecallGoldHit, buildResult } = await import('./run.js')

describe('parseSessionId (Task 6: recall@k session-tag parsing)', () => {
  it('extracts a session id from a tagged memory string', () => {
    expect(parseSessionId('[session=abc123 date=2024-01-01]\nUSER: hi')).toBe('abc123')
  })

  it('returns null when no session tag is present', () => {
    expect(parseSessionId('just plain text, no tag')).toBeNull()
  })

  it('returns null for a malformed/empty session id', () => {
    expect(parseSessionId('[session= date=2024-01-01]')).toBeNull()
  })

  it('extracts the first session id when multiple sessions are concatenated in one string', () => {
    expect(parseSessionId('[session=s1 date=x]\nfoo\n[session=s2 date=y]\nbar')).toBe('s1')
  })
})

describe('computeRecallGoldHit (Task 6: recall@k metric)', () => {
  it('is true when a recalled memory session id matches a gold session id', () => {
    const memories = ['[session=s1 date=x]\nfoo', '[session=s2 date=y]\nbar']
    expect(computeRecallGoldHit(memories, ['s2'])).toBe(true)
  })

  it('is false when no recalled memory session id matches any gold session id', () => {
    const memories = ['[session=s1 date=x]\nfoo']
    expect(computeRecallGoldHit(memories, ['s9'])).toBe(false)
  })

  it('is false for an empty recalled-memories list', () => {
    expect(computeRecallGoldHit([], ['s1'])).toBe(false)
  })

  it('is false when gold_session_ids is empty even if memories were recalled', () => {
    expect(computeRecallGoldHit(['[session=s1 date=x]\nfoo'], [])).toBe(false)
  })
})

describe('buildResult (Task 3 + Task 6: details capture + recall_at_k aggregation)', () => {
  const baseArgs = {
    n: 2,
    seed: 42,
    backend: 'in-memory' as const,
    topK: 30,
    output: 'results/out.json',
    dryRun: false,
    help: false,
  }

  it('computes recall_at_k separately from overall_accuracy, overall and by type', () => {
    const details: NonNullable<RunResult['details']> = [
      {
        question_id: 'q1',
        question_type: 'multi-session',
        correct: true,
        model_answer: 'a',
        ground_truth: 'a',
        recalled_memory_count: 1,
        recalled_memories: ['[session=s1 date=x]\nfoo'],
        gold_session_ids: ['s1'],
        recalled_gold_hit: true,
      },
      {
        question_id: 'q2',
        question_type: 'multi-session',
        correct: false,
        model_answer: 'b',
        ground_truth: 'a',
        recalled_memory_count: 1,
        recalled_memories: ['[session=s9 date=x]\nbar'],
        gold_session_ids: ['s2'],
        recalled_gold_hit: false,
      },
    ]

    const result = buildResult(
      baseArgs,
      [{ question_type: 'multi-session' }, { question_type: 'multi-session' }],
      details,
      [],
      { prompt_tokens: 0, completion_tokens: 0 },
      1,
    )

    expect(result.overall_accuracy).toBe(0.5)
    expect(result.recall_at_k).toBe(0.5)
    expect(result.recall_at_k_by_type['multi-session']).toBe(0.5)
    // Task 3: retrieved memories and gold session ids are preserved on details.
    expect(result.details?.[0]?.recalled_memories).toEqual(['[session=s1 date=x]\nfoo'])
    expect(result.details?.[0]?.gold_session_ids).toEqual(['s1'])
  })

  it('accuracy and recall_at_k can diverge (reader wrong but retrieval correct, and vice versa)', () => {
    const details: NonNullable<RunResult['details']> = [
      {
        question_id: 'q1',
        question_type: 'temporal-reasoning',
        correct: false, // reader got the arithmetic wrong
        model_answer: 'wrong',
        ground_truth: 'right',
        recalled_memory_count: 1,
        recalled_memories: ['[session=s1 date=x]\nfoo'],
        gold_session_ids: ['s1'],
        recalled_gold_hit: true, // but retrieval found the right evidence
      },
    ]

    const result = buildResult(
      baseArgs,
      [{ question_type: 'temporal-reasoning' }],
      details,
      [],
      { prompt_tokens: 0, completion_tokens: 0 },
      1,
    )

    expect(result.overall_accuracy).toBe(0)
    expect(result.recall_at_k).toBe(1)
  })

  it('handles an empty details array without dividing by zero', () => {
    const result = buildResult(baseArgs, [], [], [], { prompt_tokens: 0, completion_tokens: 0 }, 0)
    expect(result.overall_accuracy).toBe(0)
    expect(result.recall_at_k).toBe(0)
  })
})
