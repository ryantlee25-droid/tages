/**
 * Tests for PLAN.md Task 6 — cross-encoder rerank parity, server package.
 *
 * IMPORTANT: these tests MOCK `@huggingface/transformers`'s pipeline API —
 * they never download or run the real ONNX model. Real-model behavior is
 * validated separately by Task 6's E2E "real-product probe" (PLAN.md Task 6
 * E2E Validation), not by this suite.
 *
 * `reranker.ts` caches its loaded pipeline in a module-level singleton (real,
 * intentional behavior — "cached to disk on first use, no network call after
 * first load"). To keep each test's mock behavior isolated, the module is
 * re-imported fresh (`vi.resetModules()`) before every test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Avoids the extensionless-relative-import TS2835 restriction that
// `import type * as X from '../y'` hits under this package's Node16 module
// resolution — `typeof import(...)` is a type-only construct with no
// runtime import statement, so it isn't subject to that rule. `typeof
// import(...)` only exposes runtime (value) exports, so the type-only
// `RerankCandidate` interface is referenced separately below.
type RerankerModule = typeof import('../search/reranker')
type RerankCandidate = import('../search/reranker').RerankCandidate

const mockModel = vi.fn()
const mockTokenizer = vi.fn((_query: string, opts?: { text_pair?: string }) => ({
  text_pair: opts?.text_pair,
}))
const mockModelFromPretrained = vi.fn(async (..._a: unknown[]) => mockModel)
const mockTokenizerFromPretrained = vi.fn(async (..._a: unknown[]) => mockTokenizer)

// Mock the REAL cross-encoder shape the production code depends on:
// tokenizer(query,{text_pair}) -> inputs, model(inputs) -> {logits:{data:[logit]}}.
// Returning DISTINCT logits per candidate is the regression guard for the
// silent-no-op bug (the old text-classification pipeline returned a constant
// score, so rerank did nothing while tests stayed green).
vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: (...a: unknown[]) => mockTokenizerFromPretrained(...a) },
  AutoModelForSequenceClassification: { from_pretrained: (...a: unknown[]) => mockModelFromPretrained(...a) },
}))

// Parse a `score=<n>` marker out of the candidate text so each test controls
// ranking deterministically without a real model.
function scoreFromText(text: string): number {
  const match = text.match(/score=([\d.]+)/)
  return match ? Number(match[1]) : 0
}
function useTextScoreModel() {
  mockModel.mockImplementation(async (inputs: { text_pair?: string }) => ({
    logits: { data: [scoreFromText(inputs.text_pair ?? '')] },
  }))
}

let mod: RerankerModule

beforeEach(async () => {
  mockModel.mockReset()
  mockTokenizer.mockClear()
  mockModelFromPretrained.mockClear()
  mockModelFromPretrained.mockResolvedValue(mockModel)
  mockTokenizerFromPretrained.mockClear()
  mockTokenizerFromPretrained.mockResolvedValue(mockTokenizer)
  delete process.env.OPENAI_API_KEY
  vi.resetModules()
  mod = await import('../search/reranker.js')
})

describe('LocalCrossEncoderReranker', () => {
  it('reorders candidates per a mocked model run', async () => {
    useTextScoreModel()

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'score=0.2 low relevance' },
      { id: 'b', text: 'score=0.9 high relevance' },
      { id: 'c', text: 'score=0.5 mid relevance' },
    ]

    const result = await new mod.LocalCrossEncoderReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['b', 'c', 'a'])
  })

  it('only sends the top 20 candidates to the model (payload length)', async () => {
    useTextScoreModel()

    const candidates: RerankCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      text: `score=${i} candidate ${i}`,
    }))

    await new mod.LocalCrossEncoderReranker().rerank('q', candidates, 20)
    // Only the top-K (20) window is scored, not all 30.
    expect(mockModel).toHaveBeenCalledTimes(20)
  })
})

describe('rerank() selection + fallback', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('falls back to OpenAIJudgeReranker when the local model fails to load', async () => {
    mockModelFromPretrained.mockRejectedValue(new Error('model load failed'))
    process.env.OPENAI_API_KEY = 'test-key'

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

    const result = await mod.rerank('q', candidates, 20)
    expect(result).toEqual(['b', 'a'])
    expect(fetchMock).toHaveBeenCalled()
  })

  it('fails open (input order unchanged, no throw) when both backends are unavailable', async () => {
    mockModelFromPretrained.mockRejectedValue(new Error('model load failed'))
    // No OPENAI_API_KEY set.

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
      { id: 'c', text: 'third' },
    ]

    const result = await mod.rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('returns an empty array for an empty candidate list without invoking either backend', async () => {
    const result = await mod.rerank('q', [], 20)
    expect(result).toEqual([])
    expect(mockModelFromPretrained).not.toHaveBeenCalled()
  })
})

describe('OpenAIJudgeReranker', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns input order unchanged when no API key is configured', async () => {
    delete process.env.OPENAI_API_KEY
    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]
    const result = await new mod.OpenAIJudgeReranker().rerank('q', candidates, 20)
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
    const result = await new mod.OpenAIJudgeReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b'])
  })

  it('returns input order unchanged on network error', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    const candidates: RerankCandidate[] = [
      { id: 'a', text: 'first' },
      { id: 'b', text: 'second' },
    ]
    const result = await new mod.OpenAIJudgeReranker().rerank('q', candidates, 20)
    expect(result).toEqual(['a', 'b'])
  })
})

describe('rerankMemories', () => {
  it('re-splices the reranked top-K to the front, appending the rest in original order', async () => {
    useTextScoreModel()

    const memories = [
      { id: '1', value: 'score=0.1 one' },
      { id: '2', value: 'score=0.9 two' },
      { id: '3', value: 'score=0.5 three' },
      { id: '4', value: 'unrelated four' }, // beyond topK=3, keeps original position
    ]

    const result = await mod.rerankMemories(memories, 'q', 3)
    expect(result.map((m) => m.id)).toEqual(['2', '3', '1', '4'])
  })

  it('returns the input unchanged for an empty list', async () => {
    const result = await mod.rerankMemories([], 'q', 20)
    expect(result).toEqual([])
  })
})
