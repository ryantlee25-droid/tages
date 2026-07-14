import { describe, it, expect, vi, afterEach } from 'vitest'

import { OpenAIJudgeReranker, rerankCandidates, type RerankCandidate } from '../lib/reranker.js'

describe('OpenAIJudgeReranker', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
  })

  it('ranks candidates per the model listwise JSON response', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[2,0,1]' } }],
      }),
    }) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
      { id: 'c', text: 'third' },
    ]

    const reranker = new OpenAIJudgeReranker()
    const result = await reranker.rerank('query', candidates, 3)

    expect(result).toEqual(['c', 'a', 'b'])
  })

  it('falls back to input order unchanged on malformed JSON', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not json at all' } }],
      }),
    }) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [{ id: 'a', text: 'first' }]

    const reranker = new OpenAIJudgeReranker()
    await expect(reranker.rerank('query', candidates, 1)).rejects.toThrow()
  })

  it('throws on a network error (caller handles fallback)', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [{ id: 'a', text: 'first' }]
    const reranker = new OpenAIJudgeReranker()

    await expect(reranker.rerank('query', candidates, 1)).rejects.toThrow('network down')
  })

  it('throws when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY
    const reranker = new OpenAIJudgeReranker()
    await expect(reranker.rerank('query', [{ id: 'a', text: 'x' }], 1)).rejects.toThrow()
  })
})

describe('rerankCandidates (orchestrator)', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('uses the OpenAI judge when opted in and the call succeeds', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.TAGES_OPENAI_EMBED = '1'
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[1,0]' } }] }),
    }) as unknown as typeof fetch

    const result = await rerankCandidates(
      'q',
      [
        { id: 'a', text: 'first' },
        { id: 'b', text: 'second' },
      ],
      2,
    )

    expect(result).toEqual(['b', 'a'])
  })

  it('returns input order unchanged when not opted in (no key/flag), no throw', async () => {
    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    await expect(rerankCandidates('q', candidates, 2)).resolves.toEqual(['a', 'b'])
  })

  it('returns input order unchanged when the judge is opted in but the call fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.TAGES_OPENAI_EMBED = '1'
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    await expect(rerankCandidates('q', candidates, 2)).resolves.toEqual(['a', 'b'])
  })

  it('returns input order unchanged when OPENAI_API_KEY is set but TAGES_OPENAI_EMBED is not', async () => {
    process.env.OPENAI_API_KEY = 'test-key'

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    await expect(rerankCandidates('q', candidates, 2)).resolves.toEqual(['a', 'b'])
  })

  it('returns an empty array for an empty candidate list', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(rerankCandidates('q', [], 20)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
