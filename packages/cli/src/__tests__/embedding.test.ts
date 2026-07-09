/**
 * Tests for Task 10: CLI-local embedding provider parity.
 *
 * packages/cli/src/lib/embedding.ts mirrors the server's Ollama -> OpenAI
 * fallback chain (packages/server/src/embeddings.ts) without importing from
 * @tages/server (that would break standalone `npm install -g @tages/cli`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateEmbedding } from '../lib/embedding.js'

describe('CLI generateEmbedding (provider parity)', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY
  const originalEmbedFlag = process.env.TAGES_OPENAI_EMBED

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    if (originalEmbedFlag === undefined) delete process.env.TAGES_OPENAI_EMBED
    else process.env.TAGES_OPENAI_EMBED = originalEmbedFlag
  })

  it('returns a normalized 1536-dim embedding when Ollama succeeds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    }) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    // Padding preserves original values then zero-fills the rest
    expect(result!.slice(0, 768)).toEqual(new Array(768).fill(0.1))
    expect(result!.slice(768)).toEqual(new Array(768).fill(0))
  })

  it('does NOT fall back to OpenAI by default, even when OPENAI_API_KEY is set (fail-fast — findings 5/6)', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    // No TAGES_OPENAI_EMBED opt-in.

    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return Promise.reject(new Error('Connection refused'))
      }
      if (typeof url === 'string' && url.includes('api.openai.com')) {
        openAiCalls++
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
        })
      }
      return Promise.reject(new Error('unexpected url'))
    }) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    // Ollama down + no opt-in => null (caller falls back to trigram), no charge.
    expect(result).toBeNull()
    expect(openAiCalls).toBe(0)
  })

  it('falls back to OpenAI only when opted in via TAGES_OPENAI_EMBED=1', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++
      if (typeof url === 'string' && url.includes('11434')) {
        return Promise.reject(new Error('Connection refused'))
      }
      if (typeof url === 'string' && url.includes('api.openai.com')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
        })
      }
      return Promise.reject(new Error('unexpected url'))
    }) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    expect(callCount).toBe(2) // Ollama attempted, then OpenAI
  })

  it('honors an explicit allowOpenAIFallback:false even when the env flag is on', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return Promise.reject(new Error('Connection refused'))
      }
      if (typeof url === 'string' && url.includes('api.openai.com')) {
        openAiCalls++
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }) })
      }
      return Promise.reject(new Error('unexpected url'))
    }) as unknown as typeof fetch

    const result = await generateEmbedding('some query', { allowOpenAIFallback: false })
    expect(result).toBeNull()
    expect(openAiCalls).toBe(0)
  })

  it('returns null when Ollama fails and OPENAI_API_KEY is not set', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    expect(result).toBeNull()
  })

  it('renormalizes an oversized (>1536-dim) embedding instead of returning a raw slice', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(3072).fill(0.02) }),
    }) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    const norm = Math.sqrt(result!.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1, 6)
  })
})

/**
 * Tests for the chunking bug fix (Task A of the "Tier-1 Retrieval-Quality
 * Fixes" plan), CLI mirror of packages/server/src/__tests__/embeddings.test.ts.
 * Requires the TAGES_OPENAI_EMBED opt-in flag since this module's OpenAI
 * fallback is off by default (see the module header).
 */
describe('CLI generateEmbedding chunking + error handling (Task A)', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY
  const originalEmbedFlag = process.env.TAGES_OPENAI_EMBED

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    if (originalEmbedFlag === undefined) delete process.env.TAGES_OPENAI_EMBED
    else process.env.TAGES_OPENAI_EMBED = originalEmbedFlag
  })

  function rejectOllama(url: string): boolean {
    return typeof url === 'string' && url.includes('11434')
  }

  function dot(a: number[], b: number[]): number {
    return a.reduce((sum, v, i) => sum + v * b[i], 0)
  }

  function l2Norm(v: number[]): number {
    return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
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

    const longText = 'lorem ipsum dolor sit amet '.repeat(2000)
    const result = await generateEmbedding(longText)

    expect(result).not.toBeNull()
    expect(openAiCalls).toBeGreaterThan(1)
  })

  it('pools chunk vectors into a 1536-dim, unit-length vector with positive, high cosine similarity to each chunk', async () => {
    const usedVectors: number[][] = []
    let callIndex = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
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
