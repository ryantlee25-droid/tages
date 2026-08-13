/**
 * Mixed-provider regression guard (PLAN-HOSTED-EMBEDDING.md Task 2).
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * `embedOne()` used to call `embedViaOllama(text)` unconditionally on every
 * call, gated by nothing; only the OpenAI leg sat behind an env var. So two
 * teammates could silently write vectors from DIFFERENT models into one shared
 * index purely because one of them happened to have Ollama running for an
 * unrelated project. Cosine similarity across models is meaningless, so that
 * index returns confident nonsense — with no error anywhere.
 *
 * WHY THESE TESTS AND NOT "hosted is the default"
 * -----------------------------------------------
 * Asserting the default would only prove a preference. What has to be true is
 * an INVARIANT: within one process there is no reachable code path that lets
 * two different providers produce vectors. So every test below makes ALL THREE
 * providers simultaneously available and healthy — Ollama answering, an
 * OPENAI_API_KEY present, the hosted endpoint up — which is precisely the
 * situation that used to silently mix them, and then asserts that exactly one
 * of them is ever contacted across a full mixed read/write workload.
 *
 * The three properties asserted:
 *   1. Resolution happens ONCE per process and is immune to later env changes,
 *      so a mid-run reconfiguration cannot split one write across two spaces.
 *   2. Across a mixed workload (query embed + pooled doc embed + per-chunk
 *      embeds + batch backfill embeds), exactly ONE provider host is contacted.
 *   3. A provider FAILING does not escalate to another provider — it returns
 *      null, which callers already treat as "skip semantic search".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateEmbedding,
  generateChunkEmbeddings,
  generateHostedEmbeddingsBatch,
  resolveEmbeddingProvider,
  embeddingProvidersUsedThisProcess,
  __resetEmbeddingProviderForTests,
} from '../embeddings'

const OLLAMA_HOST = '11434'
const OPENAI_HOST = 'api.openai.com'
const HOSTED_HOST = 'test-project.supabase.co'

type ProviderHost = 'ollama' | 'openai' | 'hosted'

function classify(url: string): ProviderHost {
  if (url.includes(OLLAMA_HOST)) return 'ollama'
  if (url.includes(OPENAI_HOST)) return 'openai'
  if (url.includes(HOSTED_HOST)) return 'hosted'
  throw new Error(`Unexpected embedding endpoint contacted: ${url}`)
}

/**
 * A fetch mock in which EVERY provider is healthy and answering, recording
 * which hosts were actually contacted. This is the "ambient Ollama" scenario
 * that produced the original bug.
 */
function makeAllProvidersHealthyFetch(): {
  fetch: typeof fetch
  hostsContacted: () => ProviderHost[]
} {
  const hosts = new Set<ProviderHost>()
  const impl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const host = classify(url)
    hosts.add(host)
    if (host === 'ollama') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: new Array(768).fill(0.11) }),
      })
    }
    if (host === 'openai') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.22) }] }),
      })
    }
    const body = JSON.parse(String(init?.body ?? '{}'))
    const count = Array.isArray(body.texts) ? body.texts.length : 1
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          model: 'gte-small',
          dims: 384,
          embeddings: Array.from({ length: count }, () => new Array(384).fill(0.33)),
        }),
    })
  })
  return { fetch: impl as unknown as typeof fetch, hostsContacted: () => [...hosts] }
}

/**
 * Everything a `remember` + `recall` cycle asks of this module in one run: a
 * query vector, a pooled document vector, per-chunk vectors, and (for hosted)
 * the batch entry point the backfill script uses. If any pairing of these
 * could disagree on provider, this workload would reveal it.
 */
async function runMixedWorkload(provider: string): Promise<void> {
  const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(400)
  await generateEmbedding('a recall query', { projectId: 'proj-1' })
  await generateEmbedding(longText, { projectId: 'proj-1' })
  await generateChunkEmbeddings(longText, { projectId: 'proj-1' })
  if (provider === 'hosted') {
    await generateHostedEmbeddingsBatch(['backfill a', 'backfill b'], { projectId: 'proj-1' })
  }
}

describe('mixed-provider regression: provider uniformity is structural', () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    provider: process.env.TAGES_EMBED_PROVIDER,
    openaiKey: process.env.OPENAI_API_KEY,
    legacy: process.env.TAGES_OPENAI_EMBED,
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.TAGES_SERVICE_KEY,
  }

  beforeEach(() => {
    // Make every provider viable at once — the exact ambient condition that
    // used to mix vector spaces.
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.SUPABASE_URL = `https://${HOSTED_HOST}`
    process.env.TAGES_SERVICE_KEY = 'test-service-key'
    delete process.env.TAGES_OPENAI_EMBED
    __resetEmbeddingProviderForTests()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [key, value] of [
      ['TAGES_EMBED_PROVIDER', originalEnv.provider],
      ['OPENAI_API_KEY', originalEnv.openaiKey],
      ['TAGES_OPENAI_EMBED', originalEnv.legacy],
      ['SUPABASE_URL', originalEnv.supabaseUrl],
      ['TAGES_SERVICE_KEY', originalEnv.serviceKey],
    ] as Array<[string, string | undefined]>) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    __resetEmbeddingProviderForTests()
  })

  // --- Property 1: resolution happens once per process -----------------------

  it('resolves the provider exactly once and ignores every later env change', () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    expect(resolveEmbeddingProvider()).toBe('ollama')

    // Someone (a test, a wrapper script, a rogue tool) rewrites the env
    // mid-process. The memo must not budge — a provider that could change
    // mid-run is exactly how one logical write ends up spanning two vector
    // spaces.
    process.env.TAGES_EMBED_PROVIDER = 'openai'
    expect(resolveEmbeddingProvider()).toBe('ollama')

    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    expect(resolveEmbeddingProvider()).toBe('ollama')

    delete process.env.TAGES_EMBED_PROVIDER
    expect(resolveEmbeddingProvider()).toBe('ollama')
  })

  it('an env change mid-workload cannot split one run across two providers', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    const { fetch: f, hostsContacted } = makeAllProvidersHealthyFetch()
    globalThis.fetch = f

    await generateEmbedding('first write', { projectId: 'proj-1' })
    // Flip the env between the two halves of the same logical run.
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    await generateEmbedding('second write', { projectId: 'proj-1' })
    await generateChunkEmbeddings('third write', { projectId: 'proj-1' })

    expect(hostsContacted()).toEqual(['hosted'])
    expect(embeddingProvidersUsedThisProcess()).toEqual(['hosted'])
  })

  // --- Property 2: one provider per run, whatever the workload ---------------

  for (const provider of ['hosted', 'ollama', 'openai'] as const) {
    it(`contacts exactly ONE provider host across a full mixed workload (provider=${provider})`, async () => {
      process.env.TAGES_EMBED_PROVIDER = provider
      const { fetch: f, hostsContacted } = makeAllProvidersHealthyFetch()
      globalThis.fetch = f

      await runMixedWorkload(provider)

      // The load-bearing assertion: not "the right one was used" but "no
      // second one was ever touched", with all three simultaneously healthy.
      expect(hostsContacted()).toHaveLength(1)
      expect(hostsContacted()[0]).toBe(provider)
      expect(embeddingProvidersUsedThisProcess()).toEqual([provider])
    })
  }

  it('query vectors and stored chunk vectors come from the same provider in one run', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    const { fetch: f, hostsContacted } = makeAllProvidersHealthyFetch()
    globalThis.fetch = f

    const query = await generateEmbedding('what is the convention', { projectId: 'p' })
    const chunks = await generateChunkEmbeddings('a stored memory value', { projectId: 'p' })

    expect(query).not.toBeNull()
    expect(chunks).not.toBeNull()
    expect(hostsContacted()).toEqual(['hosted'])

    // Same vector space in the only way this module can express it: identical
    // provenance for the fill value each mocked provider emits. An
    // Ollama-space query against hosted-space chunks would differ here.
    expect(query!.slice(0, 384)).toEqual(new Array(384).fill(0.33))
    expect(chunks!.chunks[0].embedding.slice(0, 384)).toEqual(new Array(384).fill(0.33))
  })

  // --- Property 3: failure degrades, it does not escalate -------------------

  it('a hosted failure returns null and NEVER escalates to Ollama or OpenAI', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.TAGES_EMBED_PROVIDER = 'hosted'

    const hosts = new Set<ProviderHost>()
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      hosts.add(classify(url))
      if (classify(url) === 'hosted') {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: () => Promise.resolve('{"error":"upstream failed","code":"upstream_error"}'),
        })
      }
      // Both local providers are healthy and would happily answer — the old
      // probe chain would have taken one of them and poisoned the index.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: new Array(768).fill(0.9) }),
      })
    }) as unknown as typeof fetch

    await expect(generateEmbedding('a query', { projectId: 'p' })).resolves.toBeNull()
    await expect(generateChunkEmbeddings('a value', { projectId: 'p' })).resolves.toBeNull()

    expect([...hosts]).toEqual(['hosted'])
    errorSpy.mockRestore()
  })

  it('an Ollama failure returns null and NEVER escalates to OpenAI, even with a key set', async () => {
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    expect(process.env.OPENAI_API_KEY).toBeTruthy()

    const hosts = new Set<ProviderHost>()
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      hosts.add(classify(url))
      if (classify(url) === 'ollama') return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ embedding: new Array(1536).fill(0.22) }] }),
      })
    }) as unknown as typeof fetch

    await expect(generateEmbedding('a query', { projectId: 'p' })).resolves.toBeNull()
    expect([...hosts]).toEqual(['ollama'])
  })

  it('an OpenAI failure returns null and NEVER escalates to Ollama, even with Ollama healthy', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.TAGES_EMBED_PROVIDER = 'openai'

    const hosts = new Set<ProviderHost>()
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      hosts.add(classify(url))
      if (classify(url) === 'openai') {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: { get: () => null },
          text: () => Promise.resolve('internal server error'),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embedding: new Array(768).fill(0.11) }),
      })
    }) as unknown as typeof fetch

    await expect(generateEmbedding('a query', { projectId: 'p' })).resolves.toBeNull()
    expect([...hosts]).toEqual(['openai'])
    errorSpy.mockRestore()
  })

  // --- Guard on the resolution rules themselves -----------------------------

  it('an unrecognized TAGES_EMBED_PROVIDER falls back to hosted, never to a local probe', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.TAGES_EMBED_PROVIDER = 'ollamma' // typo
    expect(resolveEmbeddingProvider()).toBe('hosted')

    const { fetch: f, hostsContacted } = makeAllProvidersHealthyFetch()
    globalThis.fetch = f
    await generateEmbedding('a query', { projectId: 'p' })
    expect(hostsContacted()).toEqual(['hosted'])
    errorSpy.mockRestore()
  })

  it('legacy TAGES_OPENAI_EMBED=1 maps to openai only when TAGES_EMBED_PROVIDER is unset', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    delete process.env.TAGES_EMBED_PROVIDER
    process.env.TAGES_OPENAI_EMBED = '1'
    expect(resolveEmbeddingProvider()).toBe('openai')

    // An explicit TAGES_EMBED_PROVIDER always wins over the legacy alias.
    __resetEmbeddingProviderForTests()
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    expect(resolveEmbeddingProvider()).toBe('hosted')

    errorSpy.mockRestore()
  })
})
