/**
 * Tests for Task 10: CLI-local embedding provider parity, extended by
 * PLAN-HOSTED-EMBEDDING.md Task 3 (hosted provider + deterministic switch).
 *
 * packages/cli/src/lib/embedding.ts mirrors the server's provider selection
 * (packages/server/src/embeddings.ts) without importing from @tages/server
 * (that would break standalone `npm install -g @tages/cli`).
 *
 * Every suite sets TAGES_EMBED_PROVIDER explicitly. A test that leaves the
 * provider implicit is testing the default (hosted), not the branch it thinks
 * it is — exactly the class of mistake the old unconditional Ollama probe hid
 * behind. The provider is memoized per process, so every suite also calls
 * __resetEmbeddingProviderForTests() between cases — without it the first
 * test's provider would silently win for the whole file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateEmbedding,
  generateChunkEmbeddings,
  resolveEmbeddingProvider,
  __resetEmbeddingProviderForTests,
  HOSTED_CHUNK_TARGET_CHARS,
  HOSTED_CHUNK_OVERLAP_CHARS,
  HOSTED_MAX_BATCH,
} from '../lib/embedding.js'
import { chunkText } from '../lib/chunking.js'

/** Env keys every suite below saves and restores. */
const MANAGED_ENV = [
  'OPENAI_API_KEY',
  'TAGES_OPENAI_EMBED',
  'TAGES_EMBED_PROVIDER',
  'TAGES_EMBED_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TAGES_SERVICE_KEY',
  'TAGES_PROJECT_ID',
] as const

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {}
  for (const key of MANAGED_ENV) snap[key] = process.env[key]
  return snap
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of MANAGED_ENV) {
    if (snap[key] === undefined) delete process.env[key]
    else process.env[key] = snap[key]!
  }
}

function clearManagedEnv(): void {
  for (const key of MANAGED_ENV) delete process.env[key]
}

describe('CLI generateEmbedding (provider parity)', () => {
  const originalFetch = globalThis.fetch
  const envSnapshot = snapshotEnv()

  beforeEach(() => {
    clearManagedEnv()
    __resetEmbeddingProviderForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv(envSnapshot)
    __resetEmbeddingProviderForTests()
  })

  it('returns a normalized 1536-dim embedding when Ollama succeeds', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
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

  it('does NOT touch OpenAI or Ollama by default, even when OPENAI_API_KEY is set (hosted default, no fallthrough)', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    // No TAGES_EMBED_PROVIDER and no legacy opt-in => hosted, which is
    // unconfigured here, so nothing at all should be contacted.

    let openAiCalls = 0
    let ollamaCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        ollamaCalls++
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
    // Unconfigured hosted => null (caller falls back to trigram), no charge,
    // and critically no ambient-Ollama write into a hosted index.
    expect(result).toBeNull()
    expect(openAiCalls).toBe(0)
    expect(ollamaCalls).toBe(0)
  })

  it('uses OpenAI (and ONLY OpenAI, no Ollama probe) when the legacy TAGES_OPENAI_EMBED=1 alias selects it', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    let callCount = 0
    let ollamaCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++
      if (typeof url === 'string' && url.includes('11434')) {
        ollamaCalls++
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
    // Exactly ONE call: OpenAI. The old code probed Ollama first — that
    // unconditional probe is the mixed-vector-space bug being removed.
    expect(callCount).toBe(1)
    expect(ollamaCalls).toBe(0)
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

  it('returns null when the openai provider is selected but OPENAI_API_KEY is not set', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'openai'
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as unknown as typeof fetch

    const result = await generateEmbedding('some query')
    expect(result).toBeNull()
  })

  it('renormalizes an oversized (>1536-dim) embedding instead of returning a raw slice', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
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
 * The deterministic provider switch itself (PLAN-HOSTED-EMBEDDING.md Task 3).
 *
 * These are the structural guards. The bug being prevented is not "a provider
 * misbehaved" — it is "two machines silently used different providers and both
 * wrote into one index." Precedence and no-fallthrough are therefore asserted
 * directly, not inferred from a happy path.
 */
describe('CLI embedding provider switch (TAGES_EMBED_PROVIDER)', () => {
  const originalFetch = globalThis.fetch
  const envSnapshot = snapshotEnv()

  beforeEach(() => {
    clearManagedEnv()
    __resetEmbeddingProviderForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv(envSnapshot)
    __resetEmbeddingProviderForTests()
  })

  it('defaults to hosted when nothing is set', () => {
    expect(resolveEmbeddingProvider()).toBe('hosted')
  })

  it('honors each explicit value', () => {
    for (const provider of ['hosted', 'ollama', 'openai'] as const) {
      __resetEmbeddingProviderForTests()
      process.env.TAGES_EMBED_PROVIDER = provider
      expect(resolveEmbeddingProvider()).toBe(provider)
    }
  })

  it('is case- and whitespace-insensitive', () => {
    process.env.TAGES_EMBED_PROVIDER = '  OLLAMA '
    expect(resolveEmbeddingProvider()).toBe('ollama')
  })

  it('treats TAGES_OPENAI_EMBED=1 as a deprecated alias for openai, warning once', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.TAGES_OPENAI_EMBED = '1'

    expect(resolveEmbeddingProvider()).toBe('openai')
    expect(resolveEmbeddingProvider()).toBe('openai')

    const deprecationLines = errorSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((line) => line.includes('TAGES_OPENAI_EMBED is deprecated'))
    expect(deprecationLines).toHaveLength(1)
    errorSpy.mockRestore()
  })

  it('lets an explicit TAGES_EMBED_PROVIDER win over the legacy TAGES_OPENAI_EMBED alias', () => {
    process.env.TAGES_OPENAI_EMBED = '1'
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    expect(resolveEmbeddingProvider()).toBe('hosted')
  })

  it('warns and falls back to hosted on an unrecognized value rather than silently disabling embeddings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.TAGES_EMBED_PROVIDER = 'cohere'

    expect(resolveEmbeddingProvider()).toBe('hosted')
    expect(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
      'Unrecognized TAGES_EMBED_PROVIDER',
    )
    errorSpy.mockRestore()
  })

  it('resolves ONCE per process: a mid-run env change cannot split one run across two providers', () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    expect(resolveEmbeddingProvider()).toBe('ollama')

    process.env.TAGES_EMBED_PROVIDER = 'openai'
    // Memoized. Re-reading per call would let a mid-run env change put two
    // writes from one `remember` into two different vector spaces.
    expect(resolveEmbeddingProvider()).toBe('ollama')
    expect(resolveEmbeddingProvider()).toBe('ollama')
  })

  it('one write uses ONE provider for every chunk — a multi-chunk memory can never be half hosted, half Ollama', async () => {
    // The concrete regression guard. generateChunkEmbeddings embeds many
    // chunks for one memory; if any per-chunk path could pick a different
    // provider than its siblings, that single memory's chunk rows would span
    // two vector spaces and its recall would be silently garbage.
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.TAGES_SERVICE_KEY = 'service-key'
    process.env.TAGES_PROJECT_ID = 'project-1'

    const hosts = new Set<string>()
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      hosts.add(new URL(url).host)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
      })
    }) as unknown as typeof fetch

    const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(400)
    expect(chunkText(longText).length).toBeGreaterThan(1)

    const result = await generateChunkEmbeddings(longText)
    expect(result).not.toBeNull()
    expect(result!.chunks.length).toBeGreaterThan(1)
    // Every chunk hit exactly one host — the selected provider's.
    expect([...hosts]).toEqual(['localhost:11434'])
  })

  it('ollama selected + Ollama down => null, with NO OpenAI call even when a key and the legacy flag are present', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        return Promise.reject(new Error('Connection refused'))
      }
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    expect(await generateEmbedding('some query')).toBeNull()
    expect(openAiCalls).toBe(0)
  })

  it('hosted selected + hosted failing => null, with NO Ollama call even when Ollama is running', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.TAGES_SERVICE_KEY = 'service-key'
    process.env.TAGES_PROJECT_ID = 'project-1'

    let ollamaCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('11434')) {
        ollamaCalls++
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
        })
      }
      return Promise.resolve({
        ok: false,
        status: 502,
        headers: { get: () => null },
        text: () => Promise.resolve('{"error":"upstream failed","code":"upstream_error"}'),
      })
    }) as unknown as typeof fetch

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await generateEmbedding('some query')).toBeNull()
    errorSpy.mockRestore()
    // This is the regression that mattered: an ambient Ollama must never
    // rescue a failing hosted call and write a foreign-model vector.
    expect(ollamaCalls).toBe(0)
  })

  it('zero-install release gate: TAGES_EMBED_PROVIDER unset + Ollama unreachable => null, not a throw', async () => {
    // Exactly the state recall.ts must survive: no provider configured at all,
    // nothing listening on 11434. generateEmbedding must resolve to null so
    // the caller skips semantic search and falls through to trigram.
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434')) as unknown as typeof fetch
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(generateEmbedding('some query')).resolves.toBeNull()
    await expect(generateChunkEmbeddings('some memory value')).resolves.toBeNull()

    errorSpy.mockRestore()
  })
})

/**
 * The hosted provider (PLAN-HOSTED-EMBEDDING.md Task 3). `fetch` is mocked
 * throughout — no live endpoint is needed or contacted.
 */
describe('CLI generateEmbedding via the hosted endpoint', () => {
  const originalFetch = globalThis.fetch
  const envSnapshot = snapshotEnv()

  beforeEach(() => {
    clearManagedEnv()
    __resetEmbeddingProviderForTests()
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv(envSnapshot)
    __resetEmbeddingProviderForTests()
  })

  const HOSTED_OPTS = {
    supabaseUrl: 'https://example.supabase.co',
    accessToken: 'user-jwt',
    projectId: 'project-1',
  }

  /** A unit-length gte-small-shaped (384-dim) vector. */
  function gteVector(seed: number): number[] {
    const raw = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.01 + seed) + 2)
    const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0))
    return raw.map((x) => x / norm)
  }

  it('posts { text, project_id } to /functions/v1/embed with a bearer token and pads 384 -> 1536', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ model: 'gte-small', dims: 384, embeddings: [new Array(384).fill(0.1)] }),
      })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('a short memory value', HOSTED_OPTS)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://example.supabase.co/functions/v1/embed')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer user-jwt')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      text: 'a short memory value',
      project_id: 'project-1',
    })

    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    expect(result!.slice(0, 384)).toEqual(new Array(384).fill(0.1))
    expect(result!.slice(384)).toEqual(new Array(1152).fill(0))
  })

  it('never contacts Ollama or OpenAI on the hosted path', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      urls.push(url)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ model: 'gte-small', dims: 384, embeddings: [gteVector(1)] }),
      })
    }) as unknown as typeof fetch

    await generateEmbedding('a short memory value', HOSTED_OPTS)
    expect(urls.every((u) => !u.includes('11434') && !u.includes('api.openai.com'))).toBe(true)
  })

  it('strips a trailing slash on supabaseUrl instead of producing a double slash', async () => {
    const urls: string[] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      urls.push(url)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embeddings: [gteVector(1)] }),
      })
    }) as unknown as typeof fetch

    await generateEmbedding('text', { ...HOSTED_OPTS, supabaseUrl: 'https://example.supabase.co/' })
    expect(urls[0]).toBe('https://example.supabase.co/functions/v1/embed')
  })

  it('falls back to SUPABASE_URL / TAGES_SERVICE_KEY / TAGES_PROJECT_ID when no opts are passed', async () => {
    process.env.SUPABASE_URL = 'https://env.supabase.co'
    process.env.TAGES_SERVICE_KEY = 'service-role-key'
    process.env.TAGES_PROJECT_ID = 'env-project'

    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ embeddings: [gteVector(1)] }) })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('text')
    expect(result).not.toBeNull()
    expect(calls[0].url).toBe('https://env.supabase.co/functions/v1/embed')
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer service-role-key',
    )
    expect(JSON.parse(calls[0].init.body as string).project_id).toBe('env-project')
  })

  it('returns null WITHOUT a network call when hosted config is incomplete, warning once', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await generateEmbedding('text', { supabaseUrl: 'https://x.supabase.co' })).toBeNull()
    expect(await generateEmbedding('text', { supabaseUrl: 'https://x.supabase.co' })).toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
    const warnings = errorSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((line) => line.includes('Hosted embedding is selected but not configured'))
    expect(warnings).toHaveLength(1)
    errorSpy.mockRestore()
  })

  it('chunks long text at HOSTED_CHUNK_TARGET_CHARS, batches rather than one call per chunk, and pools the result', async () => {
    const calls: Array<{ init: RequestInit }> = []
    let seed = 0
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      calls.push({ init })
      const sent = JSON.parse(init.body as string) as { texts: string[] }
      const embeddings = sent.texts.map(() => gteVector(++seed))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ embeddings }) })
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(500) // ~13,500 chars
    const expectedChunks = chunkText(longText, {
      chunkSizeChars: HOSTED_CHUNK_TARGET_CHARS,
      overlapChars: HOSTED_CHUNK_OVERLAP_CHARS,
    })
    expect(expectedChunks.length).toBeGreaterThan(1)

    const result = await generateEmbedding(longText, HOSTED_OPTS)

    // Batched, not one call per chunk. Derived from HOSTED_MAX_BATCH rather
    // than pinned to 1, because the measured cap is 8 (batches >= 16 are
    // killed with HTTP 546 WORKER_LIMIT), so long text spans several calls.
    expect(calls).toHaveLength(Math.ceil(expectedChunks.length / HOSTED_MAX_BATCH))
    expect(calls.length).toBeLessThan(expectedChunks.length)
    const allSent = calls.flatMap((c) => {
      const body = JSON.parse(c.init.body as string)
      expect(body.project_id).toBe('project-1')
      expect(body.text).toBeUndefined()
      expect(body.texts.length).toBeLessThanOrEqual(HOSTED_MAX_BATCH)
      return body.texts as string[]
    })
    expect(allSent).toEqual(expectedChunks)
    expect(allSent.every((t: string) => t.length <= HOSTED_CHUNK_TARGET_CHARS)).toBe(true)

    expect(result).not.toBeNull()
    expect(result!.length).toBe(1536)
    const norm = Math.sqrt(result!.reduce((s, v) => s + v * v, 0))
    expect(norm).toBeCloseTo(1, 6)
  })

  it('pins the hosted chunk constants to the values hand-synced with the server copy', () => {
    // gte-small's window is far smaller than OpenAI's, so chunking.ts's
    // CHUNK_TARGET_CHARS (4000) must not be reused here. These are the MEASURED
    // values, not placeholders: gte-small truncates silently at ~512 tokens and
    // still returns 200, and JSON-shaped memory records hit that at 1107 chars.
    // packages/server/src/embeddings.ts must declare them identically — this
    // test is the drift guard between the two hand-synced copies.
    expect(HOSTED_CHUNK_TARGET_CHARS).toBe(800)
    expect(HOSTED_CHUNK_OVERLAP_CHARS).toBe(120)
    expect(HOSTED_MAX_BATCH).toBe(8)
  })

  it('rejects a short embeddings[] rather than pooling a partial answer', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as { texts?: string[] }
      // One vector short of the batch that was requested.
      const embeddings = (sent.texts ?? []).slice(1).map((_, i) => gteVector(i))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ embeddings }) })
    }) as unknown as typeof fetch

    const longText = 'lorem ipsum dolor sit amet '.repeat(500)
    expect(await generateEmbedding(longText, HOSTED_OPTS)).toBeNull()
  })

  it('returns null and logs the body on a structured 4xx (unauthorized / forbidden)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: () => Promise.resolve('{"error":"not a project member","code":"forbidden"}'),
    }) as unknown as typeof fetch

    expect(await generateEmbedding('text', HOSTED_OPTS)).toBeNull()
    expect(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('not a project member')
    errorSpy.mockRestore()
  })

  it('retries a 429 honoring Retry-After and succeeds on the following 200', async () => {
    let calls = 0
    globalThis.fetch = vi.fn().mockImplementation(() => {
      calls++
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? '0' : null) },
          text: () => Promise.resolve('rate limited'),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ embeddings: [gteVector(1)] }) })
    }) as unknown as typeof fetch

    const result = await generateEmbedding('text', HOSTED_OPTS)
    expect(result).not.toBeNull()
    expect(calls).toBe(2)
  })

  it('returns null (never throws) when the network call itself rejects', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND')) as unknown as typeof fetch

    await expect(generateEmbedding('text', HOSTED_OPTS)).resolves.toBeNull()
  })

  it('returns null on a malformed 200 body instead of persisting a junk vector', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ model: 'gte-small', dims: 0, embeddings: [] }),
    }) as unknown as typeof fetch

    expect(await generateEmbedding('text', HOSTED_OPTS)).toBeNull()
  })

  it('generateChunkEmbeddings routes through the hosted provider too, keeping chunk and query vectors in one space', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ embeddings: [new Array(384).fill(0.2)] }) }),
    ) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('a short memory value', HOSTED_OPTS)

    expect(result).not.toBeNull()
    expect(result!.chunks).toHaveLength(1)
    expect(result!.chunks[0].text).toBe('a short memory value')
    expect(result!.chunks[0].embedding.length).toBe(1536)
    expect(result!.chunks[0].embedding.slice(384)).toEqual(new Array(1152).fill(0))
    expect(result!.pooled).not.toBeNull()
  })
})

/**
 * Tests for the chunking bug fix (Task A of the "Tier-1 Retrieval-Quality
 * Fixes" plan), CLI mirror of packages/server/src/__tests__/embeddings.test.ts.
 *
 * These now select the openai provider EXPLICITLY. They used to rely on the
 * implicit Ollama-first-then-OpenAI chain, and the `rejectOllama` guard each
 * one carries is the fossil of that chain: under the switch, Ollama is never
 * contacted at all when openai is selected. The guards are left in place so
 * they keep failing loudly if a cross-provider fallthrough is ever
 * reintroduced.
 */
describe('CLI generateEmbedding chunking + error handling (Task A)', () => {
  const originalFetch = globalThis.fetch
  const envSnapshot = snapshotEnv()

  beforeEach(() => {
    clearManagedEnv()
    __resetEmbeddingProviderForTests()
    process.env.TAGES_EMBED_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-openai-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv(envSnapshot)
    __resetEmbeddingProviderForTests()
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

  it('returns null (not a zero vector) when the pooled chunk vectors cancel to a near-zero mean (W1)', async () => {
    const longText = 'lorem ipsum dolor sit amet '.repeat(2000)
    const chunkCount = chunkText(longText).length
    expect(chunkCount).toBeGreaterThan(1)

    let call = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      call++
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
    expect(openAiCalls).toBe(2)
  })
})

/**
 * Tests for Task 9 (Phase 2): CLI mirror of
 * packages/server/src/__tests__/embeddings.test.ts's generateChunkEmbeddings
 * suite, now pinned to an explicit openai provider.
 */
describe('CLI generateChunkEmbeddings (Task 9)', () => {
  const originalFetch = globalThis.fetch
  const envSnapshot = snapshotEnv()

  beforeEach(() => {
    clearManagedEnv()
    __resetEmbeddingProviderForTests()
    process.env.TAGES_EMBED_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-openai-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreEnv(envSnapshot)
    __resetEmbeddingProviderForTests()
  })

  function rejectOllama(url: string): boolean {
    return typeof url === 'string' && url.includes('11434')
  }

  it('returns null when OPENAI_API_KEY is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    globalThis.fetch = vi.fn() as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some memory value')
    expect(result).toBeNull()
  })

  it('needs no legacy TAGES_OPENAI_EMBED flag once TAGES_EMBED_PROVIDER=openai selects the provider', async () => {
    // Selecting the provider IS the opt-in now; the legacy flag is only an
    // alias for that selection, never a second gate on top of it.
    delete process.env.TAGES_OPENAI_EMBED
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }),
      })
    }) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some memory value')
    expect(result).not.toBeNull()
    expect(openAiCalls).toBe(1)
  })

  it('honors an explicit allowOpenAIFallback:false even when the env flag is on', async () => {
    let openAiCalls = 0
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      openAiCalls++
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.05) }] }) })
    }) as unknown as typeof fetch

    const result = await generateChunkEmbeddings('some text', { allowOpenAIFallback: false })
    expect(result).toBeNull()
    expect(openAiCalls).toBe(0)
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
    expect(result!.pooled).not.toBeNull()
    expect(result!.pooled!.length).toBe(1536)
  })

  it('multiple chunk rows with distinct embeddings for long text (15,000-char integration case)', async () => {
    let callIndex = 0
    const usedEmbeddings: number[][] = []
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (rejectOllama(url)) return Promise.reject(new Error('connection refused'))
      callIndex++
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
    result!.chunks.forEach((chunk, i) => {
      expect(chunk.embedding).toEqual(usedEmbeddings[i])
    })
    expect(result!.pooled).not.toBeNull()
    expect(result!.pooled!.length).toBe(1536)
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

  it('with the ollama provider selected, uses Ollama-space chunks and never calls OpenAI even with a key present', async () => {
    // Chunk vectors must share the query's vector space, and an Ollama team
    // must never be billed for OpenAI. Under the switch this is now
    // unconditional rather than "Ollama happened to answer first".
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
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

    const result = await generateChunkEmbeddings('some text')
    expect(ollamaCalled).toBe(true)
    expect(openAiCalls).toBe(0)
    expect(result).not.toBeNull()
    // Ollama's 768-dim vector, zero-padded to 1536 (not an OpenAI vector).
    expect(result!.chunks[0].embedding.slice(0, 768)).toEqual(new Array(768).fill(0.1))
    expect(result!.chunks[0].embedding.slice(768)).toEqual(new Array(768).fill(0))
  })
})
