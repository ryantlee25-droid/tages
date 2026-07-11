import { describe, it, expect } from 'vitest'
import {
  ANSWER_SYSTEM_PROMPT,
  ANSWER_SYSTEM_PROMPT_PREFERENCE,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildJudgeUserPrompt,
  extractFinalAnswer,
  JUDGE_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT_ABSTENTION,
  JUDGE_SYSTEM_PROMPT_PREFERENCE,
  JUDGE_SYSTEM_PROMPT_TEMPORAL,
  selectJudgeSystemPrompt,
} from './prompts.js'

describe('buildAnswerSystemPrompt (Task 2: type-aware answer prompt)', () => {
  it('selects the preference-response mode for single-session-preference', () => {
    const prompt = buildAnswerSystemPrompt('single-session-preference')
    expect(prompt).toBe(ANSWER_SYSTEM_PROMPT_PREFERENCE)
    expect(prompt).toMatch(/preference/i)
  })

  it('selects the default factual prompt for every other type', () => {
    const types = [
      'temporal-reasoning',
      'multi-session',
      'knowledge-update',
      'single-session-user',
      'single-session-assistant',
    ] as const
    for (const t of types) {
      expect(buildAnswerSystemPrompt(t)).toBe(ANSWER_SYSTEM_PROMPT)
    }
  })

  it('the default prompt includes date-arithmetic instructions', () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/date arithmetic/i)
  })

  it('the default prompt includes numeric-aggregation instructions', () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/numeric aggregation/i)
  })

  it('both prompt variants include the Chain-of-Note NOTES/ANSWER structure (Task 5)', () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/NOTES:/)
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/ANSWER:/)
    expect(ANSWER_SYSTEM_PROMPT_PREFERENCE).toMatch(/NOTES:/)
    expect(ANSWER_SYSTEM_PROMPT_PREFERENCE).toMatch(/ANSWER:/)
  })

  it('the preference prompt still preserves the abstention ("I don\'t know") escape hatch', () => {
    expect(ANSWER_SYSTEM_PROMPT_PREFERENCE).toMatch(/I don't know/)
  })
})

describe('buildAnswerUserPrompt', () => {
  it('numbers memories and includes the question', () => {
    const prompt = buildAnswerUserPrompt('What did I say?', ['first memory', 'second memory'])
    expect(prompt).toContain('[1] first memory')
    expect(prompt).toContain('[2] second memory')
    expect(prompt).toContain('Question: What did I say?')
  })

  it('handles no retrieved memories', () => {
    const prompt = buildAnswerUserPrompt('anything', [])
    expect(prompt).toContain('(no memories retrieved)')
  })

  describe('referenceDate (Task 1: temporal reader anchor)', () => {
    it('prepends a reference-date line before Question: when a date is passed', () => {
      const prompt = buildAnswerUserPrompt('How long ago was that?', ['mem1'], '2023/04/10 (Mon) 23:07')
      expect(prompt).toContain(
        'Reference date (treat as "today" for any relative-date computation): 2023/04/10 (Mon) 23:07',
      )
      const refIdx = prompt.indexOf('Reference date')
      const qIdx = prompt.indexOf('Question:')
      expect(refIdx).toBeGreaterThan(-1)
      expect(refIdx).toBeLessThan(qIdx)
    })

    it('omits the reference-date line entirely, byte-identical to the no-arg call, when referenceDate is not passed', () => {
      const withoutArg = buildAnswerUserPrompt('anything', ['mem1'])
      const withUndefined = buildAnswerUserPrompt('anything', ['mem1'], undefined)
      expect(withoutArg).not.toContain('Reference date')
      expect(withUndefined).toBe(withoutArg)
    })
  })
})

describe('extractFinalAnswer (Task 5: Chain-of-Note marker parsing)', () => {
  it('extracts the text after an ANSWER: marker', () => {
    const raw = 'NOTES:\n[1] relevant, mentions the trip date.\nANSWER: The trip was in March.'
    expect(extractFinalAnswer(raw)).toBe('The trip was in March.')
  })

  it('is case-insensitive on the marker', () => {
    const raw = 'notes: nothing relevant\nanswer: I don\'t know'
    expect(extractFinalAnswer(raw)).toBe("I don't know")
  })

  it('falls back to the full trimmed text when no marker is present', () => {
    const raw = '  Just a plain answer with no notes structure.  '
    expect(extractFinalAnswer(raw)).toBe('Just a plain answer with no notes structure.')
  })
})

describe('selectJudgeSystemPrompt (Task 1: per-type judge branching)', () => {
  it('rubric-judges single-session-preference questions', () => {
    const prompt = selectJudgeSystemPrompt({
      questionType: 'single-session-preference',
      isAbstention: false,
    })
    expect(prompt).toBe(JUDGE_SYSTEM_PROMPT_PREFERENCE)
    expect(prompt).toMatch(/rubric/i)
  })

  it('judges abstention questions on correct decline, regardless of question_type', () => {
    const prompt = selectJudgeSystemPrompt({
      questionType: 'single-session-user',
      isAbstention: true,
    })
    expect(prompt).toBe(JUDGE_SYSTEM_PROMPT_ABSTENTION)
    expect(prompt).toMatch(/decline/i)
  })

  it('abstention takes priority over preference type when both are true', () => {
    const prompt = selectJudgeSystemPrompt({
      questionType: 'single-session-preference',
      isAbstention: true,
    })
    expect(prompt).toBe(JUDGE_SYSTEM_PROMPT_ABSTENTION)
  })

  it('allows off-by-one-day tolerance for temporal-reasoning', () => {
    const prompt = selectJudgeSystemPrompt({
      questionType: 'temporal-reasoning',
      isAbstention: false,
    })
    expect(prompt).toBe(JUDGE_SYSTEM_PROMPT_TEMPORAL)
    expect(prompt).toMatch(/off by exactly one day/i)
  })

  it('regression: factual equality is unchanged for other types (multi-session, knowledge-update, single-session-user/assistant)', () => {
    const types = [
      'multi-session',
      'knowledge-update',
      'single-session-user',
      'single-session-assistant',
    ] as const
    for (const t of types) {
      const prompt = selectJudgeSystemPrompt({ questionType: t, isAbstention: false })
      expect(prompt).toBe(JUDGE_SYSTEM_PROMPT)
    }
  })
})

describe('buildJudgeUserPrompt', () => {
  it('includes question, ground truth, and candidate', () => {
    const prompt = buildJudgeUserPrompt('Q?', 'truth', 'candidate answer')
    expect(prompt).toContain('Question: Q?')
    expect(prompt).toContain('Ground truth: truth')
    expect(prompt).toContain('Candidate: candidate answer')
  })
})
