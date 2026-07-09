/**
 * Tests for embedding normalization (Task 9).
 *
 * `normalizeTo1536` used to truncate >1536-dim vectors via `.slice(0, 1536)`
 * with no renormalization, silently leaving the result no longer unit-length
 * and corrupting cosine-similarity rankings. This guards against that by
 * renormalizing (L2 norm) after truncation, and confirms the 1536-dim and
 * <1536-dim (pad) paths are unchanged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeTo1536, generateEmbedding } from '../embeddings'

function l2Norm(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
}

describe('normalizeTo1536', () => {
  it('returns a 1536-dim vector unchanged', () => {
    const input = new Array(1536).fill(0.1)
    const result = normalizeTo1536(input)
    expect(result).toBe(input)
    expect(result.length).toBe(1536)
  })

  it('pads a <1536-dim vector with zeros, preserving original values', () => {
    const input = new Array(768).fill(0.2)
    const result = normalizeTo1536(input)
    expect(result.length).toBe(1536)
    expect(result.slice(0, 768)).toEqual(input)
    expect(result.slice(768)).toEqual(new Array(768).fill(0))
  })

  it('renormalizes a >1536-dim vector after truncation so it is unit-length', () => {
    // 3072-dim vector (e.g. OpenAI text-embedding-3-large), not already unit norm.
    const input = new Array(3072).fill(0).map((_, i) => (i % 7) + 1) // varied, non-trivial values
    const result = normalizeTo1536(input)
    expect(result.length).toBe(1536)
    const norm = l2Norm(result)
    expect(norm).toBeCloseTo(1, 6)
  })

  it('does not divide by zero when a truncated all-zero vector is passed', () => {
    const input = new Array(2000).fill(0)
    const result = normalizeTo1536(input)
    expect(result.length).toBe(1536)
    expect(result.every((v) => v === 0)).toBe(true)
  })

  it('truncated + renormalized vector differs from a naive slice (proves renormalization actually happened)', () => {
    const input = new Array(2000).fill(0.05) // L2 norm of full vector is not 1
    const naiveSlice = input.slice(0, 1536)
    const result = normalizeTo1536(input)
    // Naive slice is not unit length (0.05 * sqrt(1536) ~= 1.96)
    expect(l2Norm(naiveSlice)).not.toBeCloseTo(1, 2)
    // Renormalized result is unit length
    expect(l2Norm(result)).toBeCloseTo(1, 6)
    expect(result).not.toEqual(naiveSlice)
  })
})

describe('generateEmbedding provider chain (regression, unaffected by Task 9)', () => {
  const originalFetch = globalThis.fetch
  const originalOllamaUrl = process.env.OLLAMA_URL
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_URL
    else process.env.OLLAMA_URL = originalOllamaUrl
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
  })

  it('returns a normalized 1536-dim embedding when Ollama succeeds with an oversized vector', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(3072).fill(0.03) }),
    }) as unknown as typeof fetch

    const result = await generateEmbedding('hello world')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    expect(l2Norm(result!)).toBeCloseTo(1, 6)
  })

  it('returns null when both Ollama and OpenAI are unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    const result = await generateEmbedding('hello world')
    expect(result).toBeNull()
  })
})

/**
 * Tests for the chunking bug fix (Task A of the "Tier-1 Retrieval-Quality
 * Fixes" plan): a memory value over OpenAI's ~8192-token limit used to get a
 * 400 that fell through every `if (res.ok)` branch straight to `return null`,
 * with the error body never read. Long text is now split into overlapping
 * chunks (chunking.ts), each embedded separately, and the vectors mean-pooled
 * + renormalized into one 1536-dim vector. All non-OK responses are read and
 * logged, and 429s are retried with backoff.
 */
describe('generateEmbedding chunking + error handling (Task A)', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
  })

  function rejectOllama(url: string): boolean {
    return typeof url === 'string' && url.includes('11434')
  }

  function dot(a: number[], b: number[]): number {
    return a.reduce((sum, v, i) => sum + v * b[i], 0)
  }

  it('short text (under the chunking threshold) still takes a single OpenAI call, unchanged', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value')
    expect(result).not.toBeNull()
    expect(openAiCalls).toBe(1)
  })

  it('text over the chunking threshold triggers multiple OpenAI chunk calls', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.02) }] }),
      })
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(2000) // ~54,000 chars
    const result = await generateEmbedding(longText)

    expect(result).not.toBeNull()
    expect(openAiCalls).toBeGreaterThan(1)
  })

  it('pools chunk vectors into a 1536-dim, unit-length vector with positive, high cosine similarity to each chunk', async () => {
    const usedVectors: number[][] = []
    let callIndex = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      // Similar-but-not-identical unit vectors, like embeddings of adjacent,
      // overlapping chunks from the same document would plausibly look.
      callIndex++
      const raw = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.005 + callIndex * 0.1) + 2)
      const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0))
      const unit = raw.map((x) => x / norm)
      usedVectors.push(unit)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: unit }] }),
      })
    }) as unknown as typeof fetch

    const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(2000)
    const result = await generateEmbedding(longText)

    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    expect(l2Norm(result!)).toBeCloseTo(1, 6)
    expect(usedVectors.length).toBeGreaterThan(1)

    // Pre-mortem guard: pooling must not produce a near-zero/degenerate
    // vector that passes dim/unit-length checks but is semantically useless.
    for (const v of usedVectors) {
      const cosine = dot(result!, v)
      expect(cosine).toBeGreaterThan(0.5)
    }
  })

  it('reads and logs a non-OK (400) response body instead of silently swallowing it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      return Promise.resolve({
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: () => Promise.resolve('{"error":{"message":"maximum context length is 8192 tokens"}}'),
      })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value')

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('maximum context length is 8192 tokens')
    errorSpy.mockRestore()
  })

  it('retries a 429 with backoff (honoring Retry-After) and succeeds on the following 200', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      if (openAiCalls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) },
          text: () => Promise.resolve('rate limited'),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.04) }] }),
      })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value')

    expect(result).not.toBeNull()
    expect(openAiCalls).toBe(2)
  })

  it('a single failed chunk invalidates the whole pooled result (returns null, not a partial pool)', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      if (openAiCalls === 2) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: () => Promise.resolve('internal server error'),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.02) }] }),
      })
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(2000)
    const result = await generateEmbedding(longText)

    expect(result).toBeNull()
    expect(openAiCalls).toBeGreaterThanOrEqual(2)
  })
})
