import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// CRITICAL: mock the transformers pipeline so tests never download or run
// the real ONNX model (see PLAN.md Task 2's explicit test requirement).
const mockClassify = vi.fn()
const mockPipeline = vi.fn().mockResolvedValue(mockClassify)

vi.mock('@huggingface/transformers', () => ({
  pipeline: mockPipeline,
}))

import {
  LocalCrossEncoderReranker,
  OpenAIJudgeReranker,
  rerankCandidates,
  __resetLocalPipelineCacheForTests,
  type RerankCandidate,
} from '../lib/reranker.js'

describe('LocalCrossEncoderReranker', () => {
  beforeEach(() => {
    __resetLocalPipelineCacheForTests()
    mockPipeline.mockClear()
    mockPipeline.mockResolvedValue(mockClassify)
    mockClassify.mockReset()
  })

  it('reorders candidates per the mocked model run (highest score first)', async () => {
    mockClassify.mockImplementation(async (_query: string, opts: { text_pair: string }) => {
      const scores: Record<string, number> = {
        'low relevance': 0.1,
        'high relevance': 0.9,
        'mid relevance': 0.5,
      }
      return [{ label: 'LABEL_0', score: scores[opts.text_pair] ?? 0 }]
    })

    const candidates: RerankCandidate[] = [
      { id: 'low', text: 'low relevance' },
      { id: 'high', text: 'high relevance' },
      { id: 'mid', text: 'mid relevance' },
    ]

    const reranker = new LocalCrossEncoderReranker()
    const result = await reranker.rerank('query', candidates, 3)

    expect(result).toEqual(['high', 'mid', 'low'])
  })

  it('only sends the passed-in candidates to the model (payload length assertion)', async () => {
    mockClassify.mockResolvedValue([{ label: 'LABEL_0', score: 0.5 }])
    const candidates: RerankCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      text: `text ${i}`,
    }))

    const reranker = new LocalCrossEncoderReranker()
    await reranker.rerank('query', candidates, 20)

    expect(mockClassify).toHaveBeenCalledTimes(20)
  })

  it('returns an empty array for an empty candidate list without calling the model', async () => {
    const reranker = new LocalCrossEncoderReranker()
    const result = await reranker.rerank('query', [], 20)
    expect(result).toEqual([])
    expect(mockPipeline).not.toHaveBeenCalled()
  })
})

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

  beforeEach(() => {
    __resetLocalPipelineCacheForTests()
    mockPipeline.mockClear()
    mockPipeline.mockResolvedValue(mockClassify)
    mockClassify.mockReset()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('uses the local cross-encoder when it loads and scores successfully', async () => {
    mockClassify.mockImplementation(async (_q: string, opts: { text_pair: string }) => [
      { label: 'LABEL_0', score: opts.text_pair === 'good' ? 0.9 : 0.1 },
    ])

    const result = await rerankCandidates(
      'q',
      [
        { id: 'bad', text: 'bad' },
        { id: 'good', text: 'good' },
      ],
      2,
    )

    expect(result).toEqual(['good', 'bad'])
  })

  it('falls back to OpenAIJudgeReranker when the local model fails to load', async () => {
    mockPipeline.mockRejectedValue(new Error('ONNX load failed'))
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

  it('returns input order unchanged when both backends are unavailable (no throw)', async () => {
    mockPipeline.mockRejectedValue(new Error('ONNX load failed'))
    // TAGES_OPENAI_EMBED not set -> OpenAI fallback gated off even with a key.
    process.env.OPENAI_API_KEY = 'test-key'

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    await expect(rerankCandidates('q', candidates, 2)).resolves.toEqual(['a', 'b'])
  })

  it('returns input order unchanged when neither OPENAI_API_KEY nor local model is available', async () => {
    mockPipeline.mockRejectedValue(new Error('ONNX load failed'))

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]

    await expect(rerankCandidates('q', candidates, 2)).resolves.toEqual(['a', 'b'])
  })

  it('returns an empty array for an empty candidate list', async () => {
    await expect(rerankCandidates('q', [], 20)).resolves.toEqual([])
    expect(mockPipeline).not.toHaveBeenCalled()
  })
})
