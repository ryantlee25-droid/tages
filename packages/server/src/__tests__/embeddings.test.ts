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
import {
  normalizeTo1536,
  generateEmbedding,
  generateChunkEmbeddings,
  generateHostedEmbeddingsBatch,
  resolveEmbeddingProvider,
  embeddingProvidersUsedThisProcess,
  __resetEmbeddingProviderForTests,
  HOSTED_CHUNK_TARGET_CHARS,
} from '../embeddings'
import { chunkText } from '../chunking'

function l2Norm(v: number[]): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
}

/**
 * PLAN-HOSTED-EMBEDDING.md Task 2 turned provider selection into a
 * deterministic switch resolved ONCE per process. Every suite below that
 * exercises a specific provider must therefore pin `TAGES_EMBED_PROVIDER` and
 * clear the memo, or it would inherit whichever provider a previously-run test
 * in this file resolved. The pre-Task-2 suites that used to rely on the
 * implicit "always probe Ollama, then OpenAI" chain are pinned explicitly —
 * their assertions about Ollama/OpenAI behaviour are unchanged, only the
 * selection of that provider is now stated instead of ambient.
 */
const ORIGINAL_PROVIDER_ENV = process.env.TAGES_EMBED_PROVIDER

function useProvider(provider: 'hosted' | 'ollama' | 'openai'): void {
  process.env.TAGES_EMBED_PROVIDER = provider
  __resetEmbeddingProviderForTests()
}

function restoreProviderEnv(): void {
  if (ORIGINAL_PROVIDER_ENV === undefined) delete process.env.TAGES_EMBED_PROVIDER
  else process.env.TAGES_EMBED_PROVIDER = ORIGINAL_PROVIDER_ENV
  __resetEmbeddingProviderForTests()
}

/** Hosted-provider env: a Supabase URL + a token, so resolveHostedConfig succeeds. */
function useHostedEnv(): void {
  process.env.SUPABASE_URL = 'https://test-project.supabase.co'
  process.env.TAGES_SERVICE_KEY = 'test-service-key'
}

function clearHostedEnv(): void {
  delete process.env.SUPABASE_URL
  delete process.env.TAGES_SERVICE_KEY
  delete process.env.TAGES_EMBED_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_ANON_KEY
  delete process.env.TAGES_PROJECT_ID
}

function hostedOk(dims = 384, fill = 0.05) {
  return (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    const count = Array.isArray(body.texts) ? body.texts.length : 1
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          model: 'gte-small',
          dims,
          embeddings: Array.from({ length: count }, () => new Array(dims).fill(fill)),
        }),
    })
  }
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
    useProvider('ollama')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_URL
    else process.env.OLLAMA_URL = originalOllamaUrl
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    restoreProviderEnv()
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

  it('returns null when the selected provider (ollama) is unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    const result = await generateEmbedding('hello world')
    expect(result).toBeNull()
  })
})

/**
 * PLAN-HOSTED-EMBEDDING.md Task 2: hosted is the DEFAULT provider, and its
 * failure modes must degrade to `null` (recall falls back to trigram) rather
 * than throwing or escalating to a different model.
 */
describe('hosted provider (PLAN-HOSTED-EMBEDDING Task 2)', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    clearHostedEnv()
    useHostedEnv()
    useProvider('hosted')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    clearHostedEnv()
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    restoreProviderEnv()
  })

  it('is the provider when TAGES_EMBED_PROVIDER is unset', () => {
    delete process.env.TAGES_EMBED_PROVIDER
    delete process.env.TAGES_OPENAI_EMBED
    __resetEmbeddingProviderForTests()
    expect(resolveEmbeddingProvider()).toBe('hosted')
  })

  it('POSTs to {supabaseUrl}/functions/v1/embed with a bearer token and the frozen body shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return hostedOk()(url, init)
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value', { projectId: 'proj-123' })

    expect(result).not.toBeNull()
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('https://test-project.supabase.co/functions/v1/embed')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-service-key')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.text).toBe('a short memory value')
    expect(body.project_id).toBe('proj-123')
  })

  it('zero-pads gte-small 384-dim vectors to the 1536-dim pgvector width', async () => {
    globalThis.fetch = vi.fn().mockImplementation(hostedOk(384, 0.1)) as unknown as typeof fetch
    const result = await generateEmbedding('short')
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    expect(result!.slice(384).every((v) => v === 0)).toBe(true)
  })

  it('chunks long text at HOSTED_CHUNK_TARGET_CHARS and sends ONE batched texts[] call', async () => {
    const bodies: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return hostedOk(384, 0.02)(url, init)
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(400) // ~10,800 chars
    expect(longText.length).toBeGreaterThan(HOSTED_CHUNK_TARGET_CHARS)

    const result = await generateEmbedding(longText)

    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    // One HTTP call carrying every chunk, not one call per chunk.
    expect(bodies.length).toBe(1)
    expect(Array.isArray(bodies[0].texts)).toBe(true)
    expect((bodies[0].texts as string[]).length).toBeGreaterThan(1)
    for (const t of bodies[0].texts as string[]) {
      expect(t.length).toBeLessThanOrEqual(HOSTED_CHUNK_TARGET_CHARS)
    }
  })

  it('returns null (never throws) on a hosted 5xx, so recall can fall back to trigram', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: () => Promise.resolve('{"error":"upstream failed","code":"upstream_error"}'),
    }) as unknown as typeof fetch

    await expect(generateEmbedding('a query')).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns null (never throws) when the hosted fetch rejects outright', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    await expect(generateEmbedding('a query')).resolves.toBeNull()
  })

  it('retries a hosted 429 honoring Retry-After via the shared fetchEmbeddingJson helper', async () => {
    let calls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls++
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) },
          text: () => Promise.resolve('{"error":"rate limited","code":"rate_limited"}'),
        })
      }
      return hostedOk()(url, init)
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a query')
    expect(result).not.toBeNull()
    expect(calls).toBe(2)
  })

  it('returns null and warns once when hosted is selected but unconfigured', async () => {
    clearHostedEnv()
    __resetEmbeddingProviderForTests()
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(generateEmbedding('a query')).resolves.toBeNull()
    await expect(generateEmbedding('another query')).resolves.toBeNull()

    expect(fetchSpy).not.toHaveBeenCalled()
    const warnings = errorSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.includes('Hosted embedding is selected but not configured'))
    expect(warnings.length).toBe(1) // once per process, not once per call
    errorSpy.mockRestore()
  })

  it('generateHostedEmbeddingsBatch preserves order and splits above the 128-text cap', async () => {
    const batchSizes: number[] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      batchSizes.push(Array.isArray(body.texts) ? body.texts.length : 1)
      return hostedOk()(url, init)
    }) as unknown as typeof fetch

    const texts = Array.from({ length: 300 }, (_, i) => `text ${i}`)
    const result = await generateHostedEmbeddingsBatch(texts, { projectId: 'p' })

    expect(result).not.toBeNull()
    expect(result!.length).toBe(300)
    expect(batchSizes).toEqual([128, 128, 44])
    expect(result!.every((v) => v.length === 1536)).toBe(true)
  })

  it('generateHostedEmbeddingsBatch is fail-closed: one failed sub-batch nulls the whole result', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let call = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      call++
      if (call === 2) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: () => Promise.resolve('boom'),
        })
      }
      return hostedOk()(url, init)
    }) as unknown as typeof fetch

    const texts = Array.from({ length: 200 }, (_, i) => `text ${i}`)
    await expect(generateHostedEmbeddingsBatch(texts)).resolves.toBeNull()
    errorSpy.mockRestore()
  })

  it('rejects a response whose embeddings array does not match the request length', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ model: 'gte-small', dims: 384, embeddings: [new Array(384).fill(0.1)] }),
    }) as unknown as typeof fetch

    await expect(generateHostedEmbeddingsBatch(['a', 'b', 'c'])).resolves.toBeNull()
  })

  it('uses the caller JWT from the threaded Supabase client in preference to the service key', async () => {
    const calls: RequestInit[] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push(init as RequestInit)
      return hostedOk()(url, init)
    }) as unknown as typeof fetch

    const supabaseClient = {
      supabaseUrl: 'https://from-client.supabase.co',
      auth: { getSession: async () => ({ data: { session: { access_token: 'user-jwt' } } }) },
    }

    await generateEmbedding('q', {
      supabaseClient: supabaseClient as never,
      projectId: 'proj-abc',
    })

    const headers = calls[0].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer user-jwt')
  })
})

/**
 * The explicit zero-install check from PLAN-HOSTED-EMBEDDING.md: with
 * TAGES_EMBED_PROVIDER unset and no local provider running, generateEmbedding
 * must resolve to `null` rather than throwing, so recall degrades to trigram.
 */
describe('default provider with nothing installed', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  afterEach(() => {
    globalThis.fetch = originalFetch
    clearHostedEnv()
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    restoreProviderEnv()
  })

  it('returns null (does not throw) with no provider env, no Ollama, no OpenAI key', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    clearHostedEnv()
    delete process.env.TAGES_EMBED_PROVIDER
    delete process.env.TAGES_OPENAI_EMBED
    delete process.env.OPENAI_API_KEY
    __resetEmbeddingProviderForTests()

    // Every network attempt fails, standing in for "Ollama unreachable" too.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    await expect(generateEmbedding('some query')).resolves.toBeNull()
    await expect(generateChunkEmbeddings('some memory value')).resolves.toBeNull()

    // Crucially, it never reached Ollama: hosted was selected and stayed selected.
    expect(embeddingProvidersUsedThisProcess()).toEqual(['hosted'])
    errorSpy.mockRestore()
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
    // Post-Task-2 this suite must SELECT openai explicitly. Its assertions are
    // otherwise unchanged: OpenAI chunking, 429 retry, fail-closed pooling.
    useProvider('openai')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    restoreProviderEnv()
  })

  // Retained so these tests keep proving they never touch Ollama — under the
  // openai provider they no longer even attempt it, which is the point.
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

  it('returns null (not a zero vector) when the pooled chunk vectors cancel to a near-zero mean (W1)', async () => {
    // Force a degenerate pool: make the chunk embeddings sum to exactly zero,
    // so the mean is the zero vector. Without the guard, l2-normalizing that
    // stores a zero embedding -> NaN cosine -> the memory silently never matches.
    const longText = 'lorem ipsum dolor sit amet '.repeat(2000)
    const chunkCount = chunkText(longText).length
    expect(chunkCount).toBeGreaterThan(1)

    let call = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      call++
      // First n-1 chunks return +u; the last returns the negation of their sum,
      // so the total (and thus the mean) is the zero vector.
      const embedding =
        call < chunkCount
          ? new Array(1536).fill(0.1)
          : new Array(1536).fill(-0.1 * (chunkCount - 1))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ embedding }] }) })
    }) as unknown as typeof fetch

    const result = await generateEmbedding(longText)
    expect(result).toBeNull()
  })

  it('uses a FRESH timeout signal on each retry attempt (not one latching signal)', async () => {
    // A single shared AbortSignal.timeout would be the same object across every
    // retry; a fresh per-attempt timeout is a distinct object each time.
    const seenSignals: Array<AbortSignal | undefined> = []
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      seenSignals.push(init?.signal ?? undefined)
      openAiCalls++
      if (openAiCalls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) },
          text: () => Promise.resolve('rate limited'),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.03) }] }) })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value')
    expect(result).not.toBeNull()
    expect(seenSignals.length).toBe(2)
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal)
    expect(seenSignals[1]).toBeInstanceOf(AbortSignal)
    expect(seenSignals[0]).not.toBe(seenSignals[1])
  })

  it('fails fast (bounded) on a 429 with a huge Retry-After instead of hanging for minutes', async () => {
    vi.useFakeTimers()
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '600' : null) },
        text: () => Promise.resolve('rate limited'),
      })
    }) as unknown as typeof fetch

    const promise = generateEmbedding('a short memory value')
    await vi.runAllTimersAsync()
    const result = await promise
    vi.useRealTimers()

    expect(result).toBeNull()
    // The 2s total-retry-delay budget allows exactly one bounded retry (the
    // second 429 exhausts the budget), so we stop far short of maxRetries=3 and
    // never sleep the full 600s Retry-After.
    expect(openAiCalls).toBe(2)
  })
})

/**
 * Tests for Task 9 (Phase 2): per-chunk embeddings for multi-vector chunk
 * storage. `generateChunkEmbeddings` is a separate entry point from
 * `generateEmbedding`, reusing `chunkText()` and the same per-chunk embed call
 * the pooled path uses, and fail-closed on any partial chunk failure.
 *
 * Post-Task-2 these run under an explicitly selected provider instead of the
 * old implicit probe chain; the chunk-storage assertions are unchanged.
 */
describe('generateChunkEmbeddings (Task 9)', () => {
  const originalFetch = globalThis.fetch
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    useProvider('openai')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    restoreProviderEnv()
  })

  function rejectOllama(url: string): boolean {
    return typeof url === 'string' && url.includes('11434')
  }

  it('returns null when the selected provider (openai) has no key', async () => {
    delete process.env.OPENAI_API_KEY
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some memory value')
    expect(result).toBeNull()
  })

  it('under TAGES_EMBED_PROVIDER=ollama, uses Ollama-space chunks and makes NO OpenAI call even with a key set', async () => {
    // Chunk vectors must share the query vector space, and an Ollama-selected
    // team must never be billed for OpenAI. OPENAI_API_KEY is set (beforeEach)
    // yet OpenAI must NOT be called — post-Task-2 that is guaranteed by the
    // switch having no fallthrough, not by call ordering.
    useProvider('ollama')
    let ollamaCalled = false
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        ollamaCalled = true
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
        })
      }
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some memory value')
    expect(ollamaCalled).toBe(true)
    expect(openAiCalls).toBe(0)
    expect(result).not.toBeNull()
    // Ollama's 768-dim vector zero-padded to 1536 — not an OpenAI vector.
    expect(result!.chunks[0].embedding.slice(0, 768)).toEqual(new Array(768).fill(0.1))
    expect(result!.chunks[0].embedding.slice(768)).toEqual(new Array(768).fill(0))
  })

  it('under TAGES_EMBED_PROVIDER=hosted, chunks are hosted vectors from ONE batched call', async () => {
    clearHostedEnv()
    useHostedEnv()
    useProvider('hosted')
    let hostedCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('Ollama must never be contacted under the hosted provider')
      }
      hostedCalls++
      return hostedOk(384, 0.07)(url, init)
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(400)
    const result = await generateChunkEmbeddings(longText)

    expect(result).not.toBeNull()
    expect(hostedCalls).toBe(1)
    expect(result!.chunks.length).toBeGreaterThan(1)
    // Chunked at the hosted size, not the OpenAI-sized CHUNK_TARGET_CHARS.
    for (const c of result!.chunks) {
      expect(c.text.length).toBeLessThanOrEqual(HOSTED_CHUNK_TARGET_CHARS)
    }
    clearHostedEnv()
  })

  it('single-chunk parity for short text: one chunk row, pooled equals the single embedding', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    const shortText = 'a short memory value'
    const result = await generateChunkEmbeddings(shortText)

    expect(result).not.toBeNull()
    expect(openAiCalls).toBe(1)
    expect(result!.chunks).toHaveLength(1)
    expect(result!.chunks[0].text).toBe(shortText)
    expect(result!.chunks[0].embedding).toEqual(new Array(1536).fill(0.05))
    // Pooling a single vector is a no-op (mod L2 renormalization): parity
    // with the single embedded chunk.
    expect(result!.pooled).not.toBeNull()
    expect(result!.pooled!.length).toBe(1536)
  })

  it('multiple chunk rows with distinct embeddings for long text (15,000-char integration case)', async () => {
    let callIndex = 0
    const usedEmbeddings: number[][] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      callIndex++
      // Distinct per-chunk vectors (not identical fills) so we can assert
      // the stored chunk embeddings are actually different from each other.
      const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01 + callIndex))
      usedEmbeddings.push(embedding)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding }] }),
      })
    }) as unknown as typeof fetch

    const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(400) // ~18,800 chars
    expect(longText.length).toBeGreaterThan(15000)
    expect(chunkText(longText).length).toBeGreaterThan(1)

    const result = await generateChunkEmbeddings(longText)

    expect(result).not.toBeNull()
    expect(result!.chunks.length).toBeGreaterThan(1)
    expect(result!.chunks.length).toBe(usedEmbeddings.length)
    // Every chunk's stored embedding is the exact (normalized) per-chunk
    // vector, not some pooled/averaged value.
    result!.chunks.forEach((chunk, i) => {
      expect(chunk.embedding).toEqual(usedEmbeddings[i])
    })
    // Distinct embeddings, not the same vector duplicated per chunk.
    const firstEmbedding = result!.chunks[0].embedding
    expect(result!.chunks.some((c) => c.embedding !== firstEmbedding && !arraysEqual(c.embedding, firstEmbedding))).toBe(true)
    // Pooled convenience field is still a valid 1536-dim vector.
    expect(result!.pooled).not.toBeNull()
    expect(result!.pooled!.length).toBe(1536)
  })

  it('chunk text boundaries match chunkText() output exactly', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.02) }] }),
      })
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(300)
    const expectedChunks = chunkText(longText)
    const result = await generateChunkEmbeddings(longText)

    expect(result).not.toBeNull()
    expect(result!.chunks.map((c) => c.text)).toEqual(expectedChunks)
  })

  it('fail-closed: a single failed chunk invalidates the whole chunk set (returns null, not a partial set)', async () => {
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

    const longText = 'lorem ipsum dolor sit amet '.repeat(300)
    expect(chunkText(longText).length).toBeGreaterThan(1)

    const result = await generateChunkEmbeddings(longText)
    expect(result).toBeNull()
    expect(openAiCalls).toBeGreaterThanOrEqual(2)
  })

  it('produces OpenAI chunks without ever contacting Ollama (eval config: OPENAI_API_KEY set)', async () => {
    // The OpenAI-only eval config still works, and post-Task-2 it no longer
    // even probes Ollama first — the ollama branch is unreachable here.
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        throw new Error('Ollama must never be contacted under the openai provider')
      }
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some text')
    expect(result).not.toBeNull()
    expect(openAiCalls).toBeGreaterThan(0)
    expect(result!.chunks[0].embedding).toEqual(new Array(1536).fill(0.05))
  })

  function arraysEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
})
