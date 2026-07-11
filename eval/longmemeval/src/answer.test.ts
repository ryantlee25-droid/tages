import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } }
  }
  return { default: MockOpenAI }
})

function mockChatResponse(content: string, promptTokens = 10, completionTokens = 5) {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

let generateAnswer: (typeof import('./answer.js'))['generateAnswer']
let judge: (typeof import('./answer.js'))['judge']

beforeEach(async () => {
  process.env.OPENAI_API_KEY = 'test-key'
  createMock.mockReset()
  vi.resetModules()
  const mod = await import('./answer.js')
  generateAnswer = mod.generateAnswer
  judge = mod.judge
})

describe('generateAnswer (Task 2 + Task 5: type-aware + Chain-of-Note)', () => {
  it('uses the default factual+arithmetic+CoN prompt for non-preference types', async () => {
    createMock.mockResolvedValue(mockChatResponse('NOTES: [1] relevant\nANSWER: 5150'))
    const { ANSWER_SYSTEM_PROMPT } = await import('./prompts.js')

    const { answer } = await generateAnswer('How much total?', ['mem1'], 'knowledge-update')

    expect(answer).toBe('5150')
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(ANSWER_SYSTEM_PROMPT)
  })

  it('uses the preference-response prompt for single-session-preference', async () => {
    createMock.mockResolvedValue(mockChatResponse('NOTES: n/a\nANSWER: tailored resources'))
    const { ANSWER_SYSTEM_PROMPT_PREFERENCE } = await import('./prompts.js')

    const { answer } = await generateAnswer('What do they prefer?', ['mem1'], 'single-session-preference')

    expect(answer).toBe('tailored resources')
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(ANSWER_SYSTEM_PROMPT_PREFERENCE)
  })

  it('strips the Chain-of-Note NOTES section, returning only the ANSWER: text', async () => {
    createMock.mockResolvedValue(
      mockChatResponse('NOTES: [1] mentions a March trip.\n[2] not relevant.\nANSWER: The trip was in March.'),
    )
    const { answer } = await generateAnswer('When was the trip?', ['mem1', 'mem2'], 'temporal-reasoning')
    expect(answer).toBe('The trip was in March.')
    expect(answer).not.toMatch(/NOTES:/)
  })

  it('reports prompt/completion token costs from the API response', async () => {
    createMock.mockResolvedValue(mockChatResponse('ANSWER: ok', 42, 7))
    const { cost } = await generateAnswer('q', [], 'single-session-user')
    expect(cost).toEqual({ prompt_tokens: 42, completion_tokens: 7 })
  })

  describe('referenceDate (Task 1: temporal reader anchor)', () => {
    it('forwards a passed referenceDate into the user-prompt content sent to the mocked OpenAI client', async () => {
      createMock.mockResolvedValue(mockChatResponse('ANSWER: 3 weeks ago'))

      await generateAnswer(
        'How long ago did that happen?',
        ['mem1'],
        'temporal-reasoning',
        '2023/04/10 (Mon) 23:07',
      )

      const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
      expect(call.messages[1]!.content).toContain(
        'Reference date (treat as "today" for any relative-date computation): 2023/04/10 (Mon) 23:07',
      )
    })

    it('omits the reference-date line from the user-prompt content when referenceDate is not passed', async () => {
      createMock.mockResolvedValue(mockChatResponse('ANSWER: ok'))

      await generateAnswer('q', ['mem1'], 'multi-session')

      const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
      expect(call.messages[1]!.content).not.toContain('Reference date')
    })
  })
})

describe('judge (Task 1: per-type judge branching)', () => {
  it('rubric-judges single-session-preference against the rubric text', async () => {
    createMock.mockResolvedValue(mockChatResponse('correct'))
    const { JUDGE_SYSTEM_PROMPT_PREFERENCE } = await import('./prompts.js')

    const { correct } = await judge(
      'What should the response emphasize?',
      'The user would prefer resources tailored to Adobe Premiere Pro.',
      'Suggest Premiere-specific tutorials.',
      'single-session-preference',
      false,
    )

    expect(correct).toBe(true)
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(JUDGE_SYSTEM_PROMPT_PREFERENCE)
  })

  it('rubric-fail: verdict "incorrect" is respected for preference questions', async () => {
    createMock.mockResolvedValue(mockChatResponse('incorrect'))
    const { correct } = await judge('Q', 'rubric text', 'unrelated answer', 'single-session-preference', false)
    expect(correct).toBe(false)
  })

  it('judges abstention questions on correct decline, regardless of question_type', async () => {
    createMock.mockResolvedValue(mockChatResponse('correct'))
    const { JUDGE_SYSTEM_PROMPT_ABSTENTION } = await import('./prompts.js')

    const { correct } = await judge(
      'What restaurant did I mention?',
      'Some restaurant name',
      "I don't know based on the provided memories.",
      'single-session-user',
      true,
    )

    expect(correct).toBe(true)
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(JUDGE_SYSTEM_PROMPT_ABSTENTION)
  })

  it('allows off-by-one-day tolerance for temporal-reasoning', async () => {
    createMock.mockResolvedValue(mockChatResponse('correct'))
    const { JUDGE_SYSTEM_PROMPT_TEMPORAL } = await import('./prompts.js')

    const { correct } = await judge('How many days ago?', '9 days ago', '10 days ago', 'temporal-reasoning', false)

    expect(correct).toBe(true)
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(JUDGE_SYSTEM_PROMPT_TEMPORAL)
  })

  it('regression: factual equality is unchanged for other types (e.g. multi-session)', async () => {
    createMock.mockResolvedValue(mockChatResponse('incorrect'))
    const { JUDGE_SYSTEM_PROMPT } = await import('./prompts.js')

    const { correct } = await judge('Q', 'truth', 'wrong answer', 'multi-session', false)

    expect(correct).toBe(false)
    const call = createMock.mock.calls[0]![0] as { messages: Array<{ content: string }> }
    expect(call.messages[0]!.content).toBe(JUDGE_SYSTEM_PROMPT)
  })
})
