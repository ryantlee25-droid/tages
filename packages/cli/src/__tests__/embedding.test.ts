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

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
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

  it('falls back to OpenAI when Ollama fails and OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'

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
