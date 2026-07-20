/**
 * Tests for PLAN.md Task 6 — cross-encoder rerank parity, server package.
 *
 * The local ONNX cross-encoder implementation was dropped per PLAN.md
 * Task 1 (its heavy optional runtime dependency); `OpenAIJudgeReranker` is
 * now the sole `Reranker` implementation. These tests cover the
 * OpenAI-judge behavior and the fail-open path (no API key / judge failure
 * -> input order unchanged).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { rerank, rerankMemories, OpenAIJudgeReranker, type RerankCandidate } from '../search/reranker.js'

describe('rerank() selection + fallback', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('uses OpenAIJudgeReranker when opted in (OPENAI_API_KEY + TAGES_OPENAI_EMBED)', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(['b', 'a']) } }],
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    const result = await rerank('q', candidates, 20)
    expect(result).toEqual(['b', 'a'])
    expect(fetchMock).toHaveBeenCalled()
  })

  it('is a no-op (no API call) when OPENAI_API_KEY is set but TAGES_OPENAI_EMBED is not — rerank is opt-in', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    delete process.env.TAGES_OPENAI_EMBED

    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    const result = await rerank('q', candidates, 20)
    // Input order preserved and, critically, no live gpt-4o-mini call fired on
    // the hot recall path just because an embedding key happens to be present.
    expect(result).toEqual(['a', 'b'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails open (input order unchanged, no throw) when no API key is configured', async () => {
    delete process.env.OPENAI_API_KEY

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
      { id: 'c', text: 'third' },
    ]

    const result = await rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array for an empty candidate list without invoking the judge', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await rerank('q', [], 20)
    expect(result).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OpenAIJudgeReranker', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
  })

  it('returns input order unchanged when no API key is configured', async () => {
    delete process.env.OPENAI_API_KEY
    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]
    const result = await new OpenAIJudgeReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b'])
  })

  it('returns input order unchanged on malformed JSON response', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    }) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]
    const result = await new OpenAIJudgeReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b'])
  })

  it('returns input order unchanged on network error', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]
    const result = await new OpenAIJudgeReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b'])
  })
})

describe('rerankMemories', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('re-splices the reranked top-K to the front, appending the rest in original order', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.TAGES_OPENAI_EMBED = '1'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(['2', '3', '1']) } }],
      }),
    }) as unknown as typeof fetch

    const memories = [
      { id: '1', value: 'one' },
      { id: '2', value: 'two' },
      { id: '3', value: 'three' },
      { id: '4', value: 'unrelated four' }, // beyond topK=3, keeps original position
    ]

    const result = await rerankMemories(memories, 'q', 3)
    expect(result.map((m) => m.id)).toEqual(['2', '3', '1', '4'])
  })

  it('returns the input unchanged for an empty list', async () => {
    const result = await rerankMemories([], 'q', 20)
    expect(result).toEqual([])
  })
})
