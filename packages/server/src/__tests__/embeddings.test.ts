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
