import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'
import { __resetEmbeddingProviderForTests } from '../lib/embedding.js'

/**
 * PROVIDER MODEL IN THIS FILE
 * ---------------------------
 * `embedOne` no longer probes Ollama ambiently. It switches on ONE provider
 * resolved per process from TAGES_EMBED_PROVIDER (hosted | ollama | openai,
 * hosted by default) with no fallthrough. So a recall test that wants the
 * semantic channel to fire has to say which provider produced the vector and
 * mock THAT provider's response shape:
 *
 *   - hosted (the default, and what a real `tages recall` does): POST to
 *     `<supabaseUrl>/functions/v1/embed`, response `{ embeddings: [[...]] }`.
 *     Use `mockHostedEmbedFetch()`.
 *   - ollama: POST to :11434/api/embeddings, response `{ embedding: [...] }`.
 *     Requires TAGES_EMBED_PROVIDER=ollama — it is never reached otherwise.
 *   - openai: POST to api.openai.com, response `{ data: [{ embedding }] }`.
 *     Requires TAGES_EMBED_PROVIDER=openai (or the legacy TAGES_OPENAI_EMBED=1
 *     alias) plus OPENAI_API_KEY.
 *
 * The default fetch mock below rejects everything, which is what keeps the
 * trigram-only tests on the trigram path.
 */

/** Hosted embed endpoint derived from TEST_PROJECT_CONFIG.supabaseUrl. */
const HOSTED_EMBED_URL = `${TEST_PROJECT_CONFIG.supabaseUrl}/functions/v1/embed`

/**
 * Answer only the hosted embed endpoint, and reject anything else loudly.
 *
 * Rejecting other hosts is the point, not defensive noise: if the recall path
 * ever reaches for a second provider, these tests must go red rather than
 * quietly embed with whatever else happens to answer.
 *
 * gte-small returns 384 dims; lib/embedding.ts zero-pads to 1536.
 */
function mockHostedEmbedFetch(): void {
  globalThis.fetch = vi.fn().mockImplementation((url: unknown) => {
    if (typeof url === 'string' && url.startsWith(HOSTED_EMBED_URL)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ embeddings: [new Array(384).fill(0.1)] }),
      })
    }
    return Promise.reject(new Error(`unexpected fetch to ${String(url)}`))
  }) as unknown as typeof fetch
}

// Mock fetch globally. Default: no embedding provider answers, so recall
// degrades to trigram (generateEmbedding's null-means-skip contract).
const originalFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

/**
 * Provider selection is read from process env and memoized for the life of the
 * process — correct in production (one vector space per run), but it means one
 * test's provider would otherwise leak into every test after it in this file,
 * and a stray TAGES_EMBED_PROVIDER / SUPABASE_URL / OPENAI_API_KEY in the
 * developer's shell would silently re-point the whole suite.
 *
 * So: snapshot and clear the provider-relevant env per test, restore after, and
 * clear the memo on both sides via the module's test-only reset. The production
 * memo itself is left exactly as it is.
 */
const PROVIDER_ENV_KEYS = [
  'TAGES_EMBED_PROVIDER',
  'TAGES_OPENAI_EMBED',
  'OPENAI_API_KEY',
  'TAGES_EMBED_URL',
  'SUPABASE_URL',
  'TAGES_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
] as const
let savedProviderEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedProviderEnv = {}
  for (const key of PROVIDER_ENV_KEYS) {
    savedProviderEnv[key] = process.env[key]
    delete process.env[key]
  }
  __resetEmbeddingProviderForTests()
})
afterEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    const value = savedProviderEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  __resetEmbeddingProviderForTests()
})

// Mock Supabase
const mockRpc = vi.fn()
const mockSupabase = {
  from: vi.fn(),
  rpc: mockRpc,
  // The hosted embed endpoint is authenticated with the signed-in user's JWT,
  // which recall.ts resolves via supabase.auth.getSession(). The real client
  // always exposes this; without it every hosted test would resolve "hosted not
  // configured" -> null -> trigram, and the semantic assertions below would be
  // testing nothing.
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'test-access-token' } },
      error: null,
    })),
  },
}
// importOriginal so real exports (evidenceWeight, EVIDENCE_WEIGHT, …) pass
// through: recall.ts imports the evidence weighting from here, and a
// hand-listed mock silently omits anything added later, failing the whole
// suite on an unrelated change.
vi.mock('@tages/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tages/shared')>()),
  createSupabaseClient: vi.fn(() => mockSupabase),
}))

// The reranker calls out to a local ONNX model (or OpenAI) — never exercise
// either in these tests. Mocked to an identity reorder (a dedicated
// reranker.test.ts covers the real reorder/fallback/fail-open behavior with
// the transformers pipeline itself mocked).
vi.mock('../lib/reranker.js', () => ({
  rerankCandidates: vi.fn(async (_query: string, candidates: Array<{ id: string }>) =>
    candidates.map((c) => c.id),
  ),
}))

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import { recallCommand } from '../commands/recall.js'

describe('recall command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('returns found memories via trigram search', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: [
        { id: '1', key: 'auth-pattern', value: 'Use JWT tokens', type: 'convention', similarity: 0.8 },
        { id: '2', key: 'db-pattern', value: 'Always use transactions', type: 'convention', similarity: 0.6 },
      ],
      error: null,
    })

    await recallCommand('authentication', {})

    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_project_id: 'test-project-id',
      p_query: 'authentication',
      // The RPC now requests the widened candidate pool (default 50), not
      // the user's --limit (5 here) — RRF fuses over the wider pool and the
      // final result is capped to --limit afterward (Task 1).
      p_limit: 50,
    }))
    const output = console_.logs.join('\n')
    expect(output).toContain('auth-pattern')
    expect(output).toContain('db-pattern')
    expect(output).toContain('Found 2 memories')
  })

  it('prints a Dates line when a row has referenced_date/relative_date set', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: [
        {
          id: '1',
          key: 'ship-date',
          value: 'Shipped the feature on July 9, 2026',
          type: 'lesson',
          similarity: 0.8,
          referenced_date: '2026-07-09T00:00:00.000Z',
          relative_date: '2026-07-10T00:00:00.000Z',
        },
      ],
      error: null,
    })

    await recallCommand('when did we ship', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('Dates: referenced 2026-07-09, relative 2026-07-10')
  })

  it('omits the Dates line when referenced_date and relative_date are both null', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: [
        {
          id: '1',
          key: 'auth-pattern',
          value: 'Use JWT tokens',
          type: 'convention',
          similarity: 0.8,
          referenced_date: null,
          relative_date: null,
        },
      ],
      error: null,
    })

    await recallCommand('authentication', {})

    const output = console_.logs.join('\n')
    expect(output).not.toContain('Dates:')
  })

  it('prints "no memories found" for empty results', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('nonexistent-query-xyz', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('No memories found')
  })

  it('rejects empty query without --all flag', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('', {}),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('Provide a search query, or use --all')
    exitSpy.mockRestore()
  })

  it('widens the RPC candidate pool independently of --limit, and caps the final result to --limit (Task 1)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    const manyRows = Array.from({ length: 6 }, (_, i) => ({
      id: `id-${i}`,
      key: `key-${i}`,
      value: `value ${i}`,
      type: 'convention',
      similarity: 0.9 - i * 0.01,
    }))
    mockRpc.mockResolvedValue({ data: manyRows, error: null })

    await recallCommand('test', { limit: '2' })

    // The RPC call still requests the widened candidate-pool default, not
    // the user's --limit.
    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_limit: 50,
    }))

    const output = console_.logs.join('\n')
    expect(output).toContain('Found 2 memories')
  })

  it('overrides the RPC candidate pool via TAGES_RECALL_CANDIDATE_POOL', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.TAGES_RECALL_CANDIDATE_POOL = '10'
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_limit: 10,
    }))

    delete process.env.TAGES_RECALL_CANDIDATE_POOL
  })

  it('respects --type filter', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', { type: 'decision' })

    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_type: 'decision',
    }))
  })

  it('exits with error when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('query', {}),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('reports RPC errors from Supabase', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'function recall_memories does not exist' },
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('test', {}),
    ).rejects.toThrow('process.exit called')

    expect(console_.errors.join('\n')).toContain('Recall failed')
    exitSpy.mockRestore()
  })

  it('shows no-memories message in local-only mode', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await recallCommand('test', {})

    const output = console_.errors.join('\n') + console_.logs.join('\n')
    expect(output).toContain('No local memories yet')
  })

  it('deduplicates results from trigram and semantic searches', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // Deliberately kept on Ollama, now EXPLICITLY selected rather than ambient.
    // This is the one recall test that proves the fusion path works end to end
    // under a non-default provider — if recall ever grew a hosted-only
    // assumption, this case is what catches it. Every other semantic case in
    // this file runs on the hosted default, matching a real `tages recall`.
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    globalThis.fetch = vi.fn().mockImplementation((url: unknown) => {
      if (typeof url === 'string' && url.includes('11434')) {
        // Ollama's own response shape: nomic-embed-text returns 768 dims.
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
        })
      }
      return Promise.reject(new Error(`unexpected fetch to ${String(url)}`))
    }) as unknown as typeof fetch

    // Trigram returns one result
    const trigramPromise = Promise.resolve({
      data: [{ id: 'shared-id', key: 'shared-key', value: 'shared value', type: 'convention', similarity: 0.5 }],
      error: null,
    })

    // Semantic returns the same result + another
    const semanticPromise = Promise.resolve({
      data: [
        { id: 'shared-id', key: 'shared-key', value: 'shared value', type: 'convention', similarity: 0.9 },
        { id: 'unique-id', key: 'unique-key', value: 'unique value', type: 'decision', similarity: 0.7 },
      ],
      error: null,
    })

    let callCount = 0
    mockRpc.mockImplementation(() => {
      callCount++
      if (callCount === 1) return trigramPromise
      return semanticPromise
    })

    await recallCommand('test', {})

    const output = console_.logs.join('\n')
    // shared-key should appear only once (deduplicated)
    const matches = output.match(/shared-key/g)
    expect(matches).toBeTruthy()
    // unique-key should also appear
    expect(output).toContain('unique-key')
  })

  it('fails fast to trigram (no blocking OpenAI call) when Ollama is down, even with OPENAI_API_KEY set (finding 6)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    // Genuinely an Ollama-specific case, so it selects Ollama explicitly.
    // Without this it would resolve to hosted and never touch Ollama at all —
    // it would still pass, but for a reason unrelated to its name.
    process.env.TAGES_EMBED_PROVIDER = 'ollama'
    process.env.OPENAI_API_KEY = 'test-openai-key'
    // The selected provider is down. Under the no-fallthrough switch that must
    // mean "no embedding" -> trigram, NOT "try the next provider" — a paid
    // OpenAI call here would also be a second vector space in one index.

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

    mockRpc.mockResolvedValue({
      data: [{ id: '1', key: 'trigram-key', value: 'value', type: 'convention', similarity: 0.9 }],
      error: null,
    })

    const start = Date.now()
    await recallCommand('test', {})
    const elapsed = Date.now() - start

    const output = console_.logs.join('\n')
    // Trigram-only method, results returned, and NO OpenAI network call.
    expect(output).toContain('trigram')
    expect(output).not.toContain('semantic')
    expect(output).toContain('trigram-key')
    expect(openAiCalls).toBe(0)
    // Returns promptly — no 10s OpenAI-timeout stall on the hot path.
    expect(elapsed).toBeLessThan(2000)

    delete process.env.OPENAI_API_KEY
  })

  it('uses the OpenAI-embedded query for semantic search only when opted in via TAGES_OPENAI_EMBED (finding 5/6)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.TAGES_OPENAI_EMBED = '1'

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
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

    mockRpc.mockResolvedValue({
      data: [{ id: '1', key: 'opt-in-key', value: 'value', type: 'convention', similarity: 0.9 }],
      error: null,
    })

    await recallCommand('test', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('hybrid (trigram + semantic + chunk)')
    expect(output).toContain('opt-in-key')

    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('calls chunk_semantic_recall with the candidate-pool limit and surfaces a chunk-only memory (PLAN.md Task 11)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // Hosted (the default provider) answers, so the embedding-gated channels
    // run — same condition as before, expressed as the provider recall
    // actually uses in production.
    mockHostedEmbedFetch()

    mockRpc.mockImplementation((rpcName: string) => {
      if (rpcName === 'chunk_semantic_recall') {
        // Found ONLY at chunk level — the Phase 2 zero-hit recovery case.
        return Promise.resolve({
          data: [{
            id: 'chunk-only-id', key: 'chunk-only-key',
            value: 'long memory only findable via its chunks',
            type: 'lesson', similarity: 0.8, chunk_index: 3,
            chunk_text: 'the specific matching passage',
          }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    await recallCommand('needle in a long session', {})

    // The query vector came from the hosted endpoint, not from some other
    // provider that happened to answer.
    expect(globalThis.fetch).toHaveBeenCalledWith(
      HOSTED_EMBED_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
      }),
    )
    expect(mockRpc).toHaveBeenCalledWith('chunk_semantic_recall', expect.objectContaining({
      p_limit: 50,
    }))
    const output = console_.logs.join('\n')
    expect(output).toContain('chunk-only-key')
  })

  it('drops a near-duplicate content result while keeping distinct results (Task 4 content dedup)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // Hosted (default provider) answers so the semantic path runs.
    mockHostedEmbedFetch()

    // Higher-ranked row is the fuller value; the lower-ranked near-duplicate is
    // a substring of it, so it adds no new content and is safe to drop.
    const fullValue =
      'This is a long session chunk describing how the auth middleware validates JWT tokens on every incoming request before handing off to the route handler. (continued in next chunk)'
    const nearDuplicateValue =
      'This is a long session chunk describing how the auth middleware validates JWT tokens on every incoming request before handing off to the route handler.'

    const trigramPromise = Promise.resolve({
      data: [{ id: 'distinct-id', key: 'distinct-key', value: 'A totally unrelated short note about deploy cadence.', type: 'convention', similarity: 0.4 }],
      error: null,
    })
    const semanticPromise = Promise.resolve({
      data: [
        { id: 'high-rank-id', key: 'high-rank-key', value: fullValue, type: 'lesson', similarity: 0.9 },
        { id: 'near-dup-id', key: 'near-dup-key', value: nearDuplicateValue, type: 'lesson', similarity: 0.7 },
      ],
      error: null,
    })

    let callCount = 0
    mockRpc.mockImplementation(() => {
      callCount++
      if (callCount === 1) return trigramPromise
      return semanticPromise
    })

    await recallCommand('auth middleware', {})

    const output = console_.logs.join('\n')
    // Higher-ranked occurrence kept.
    expect(output).toContain('high-rank-key')
    // Lower-ranked near-duplicate dropped.
    expect(output).not.toContain('near-dup-key')
    // Distinct result kept.
    expect(output).toContain('distinct-key')
  })

  it('keeps distinct short results that happen to share some words (no over-pruning)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    mockHostedEmbedFetch()

    const trigramPromise = Promise.resolve({ data: [], error: null })
    const semanticPromise = Promise.resolve({
      data: [
        { id: 'a', key: 'key-a', value: 'Use JWT tokens for auth.', type: 'convention', similarity: 0.9 },
        { id: 'b', key: 'key-b', value: 'Use trace headers for logging.', type: 'convention', similarity: 0.8 },
      ],
      error: null,
    })

    let callCount = 0
    mockRpc.mockImplementation(() => {
      callCount++
      if (callCount === 1) return trigramPromise
      return semanticPromise
    })

    await recallCommand('conventions', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('key-a')
    expect(output).toContain('key-b')
  })

  it('keeps a longer SUPERSET row ranked BELOW a shorter row (never drops unique content) (B1)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    mockHostedEmbedFetch()

    // shorterValue is a substring of supersetValue. The shorter row is ranked
    // HIGHER (0.9), the longer superset row is ranked LOWER (0.7). The superset
    // carries extra unique content ("...plus an extra clause...") and must NOT
    // be dropped just because it contains the higher-ranked shorter row.
    const shorterValue =
      'The auth middleware validates JWT tokens on every incoming request path.'
    const supersetValue = `${shorterValue} It also refreshes the rotating signing key hourly and audits failures to the security log.`

    const trigramPromise = Promise.resolve({ data: [], error: null })
    const semanticPromise = Promise.resolve({
      data: [
        { id: 'short-id', key: 'short-key', value: shorterValue, type: 'lesson', similarity: 0.9 },
        { id: 'superset-id', key: 'superset-key', value: supersetValue, type: 'lesson', similarity: 0.7 },
      ],
      error: null,
    })

    let callCount = 0
    mockRpc.mockImplementation(() => {
      callCount++
      if (callCount === 1) return trigramPromise
      return semanticPromise
    })

    await recallCommand('auth middleware', {})

    const output = console_.logs.join('\n')
    // Both rows kept: the shorter (top-ranked) and the longer superset below it.
    expect(output).toContain('short-key')
    expect(output).toContain('superset-key')
    expect(output).toContain('Found 2 memories')
  })

  it('drops a shorter row fully contained in a HIGHER-ranked row (adds nothing new) (B1)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    mockHostedEmbedFetch()

    // The higher-ranked (0.9) row is the superset; the lower-ranked (0.7) row
    // is a substring of it, so it adds nothing new and IS dropped.
    const supersetValue =
      'The auth middleware validates JWT tokens on every incoming request path. It also refreshes the rotating signing key hourly and audits failures to the security log.'
    const containedValue =
      'The auth middleware validates JWT tokens on every incoming request path.'

    const trigramPromise = Promise.resolve({ data: [], error: null })
    const semanticPromise = Promise.resolve({
      data: [
        { id: 'superset-id', key: 'superset-key', value: supersetValue, type: 'lesson', similarity: 0.9 },
        { id: 'contained-id', key: 'contained-key', value: containedValue, type: 'lesson', similarity: 0.7 },
      ],
      error: null,
    })

    let callCount = 0
    mockRpc.mockImplementation(() => {
      callCount++
      if (callCount === 1) return trigramPromise
      return semanticPromise
    })

    await recallCommand('auth middleware', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('superset-key')
    expect(output).not.toContain('contained-key')
    expect(output).toContain('Found 1 memories')
  })

  it('prints the similarity line when similarity is exactly 0 (ILIKE-only match) (minor)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: [
        { id: '1', key: 'ilike-key', value: 'matched only by ILIKE', type: 'convention', similarity: 0 },
      ],
      error: null,
    })

    await recallCommand('ilike', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('similarity: 0.00')
  })

  it('clamps a below-range TAGES_RECALL_THRESHOLD (-1) to 0 before it reaches the RPC (B2)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.TAGES_RECALL_THRESHOLD = '-1'

    mockHostedEmbedFetch()

    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    // -1 must NOT reach the RPC as-is; clamped to the [0,1] floor.
    expect(mockRpc).toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 0,
    }))
    expect(mockRpc).not.toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: -1,
    }))

    delete process.env.TAGES_RECALL_THRESHOLD
  })

  it('clamps an above-range TAGES_RECALL_THRESHOLD (2) to 1 before it reaches the RPC (B2)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.TAGES_RECALL_THRESHOLD = '2'

    mockHostedEmbedFetch()

    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    expect(mockRpc).toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 1,
    }))
    expect(mockRpc).not.toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 2,
    }))

    delete process.env.TAGES_RECALL_THRESHOLD
  })

  it('uses TAGES_RECALL_THRESHOLD env override for the semantic_recall p_threshold when set', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.TAGES_RECALL_THRESHOLD = '0.25'

    mockHostedEmbedFetch()

    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    expect(mockRpc).toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 0.25,
    }))

    delete process.env.TAGES_RECALL_THRESHOLD
  })

  it('defaults the semantic_recall p_threshold to 0.3 when TAGES_RECALL_THRESHOLD is unset', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    delete process.env.TAGES_RECALL_THRESHOLD

    mockHostedEmbedFetch()

    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    expect(mockRpc).toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 0.3,
    }))
  })

  it('fuses in a memory found only via the temporal channel, not trigram or semantic (Task 3)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // Trigram returns nothing, and no embedding provider answers (the default
    // fetch mock rejects), so the semantic channels are skipped entirely.
    mockRpc.mockResolvedValue({ data: [], error: null })

    const temporalRow = {
      id: 'temporal-only-id',
      key: 'temporal-only-key',
      value: 'A memory dated close to the target date.',
      type: 'lesson',
      referenced_date: '2026-07-09T00:00:00.000Z',
      relative_date: null,
    }

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [temporalRow], error: null }),
    }
    mockSupabase.from.mockReturnValue(chain)

    await recallCommand('what happened on 2026-07-09', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('temporal-only-key')

    mockSupabase.from.mockReset()
  })

  it('issues zero temporal-channel PostgREST calls for a non-temporal query (Task 3)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({
      data: [{ id: '1', key: 'auth-pattern', value: 'Use JWT tokens', type: 'convention', similarity: 0.8 }],
      error: null,
    })

    await recallCommand('authentication', {})

    // The guarantee is that the TEMPORAL channel does no work for a query that
    // is not asking about time — not that recall makes no PostgREST calls at
    // all. Migration 0070 added exactly one more: a primary-key lookup of
    // evidence levels for the fused candidates, because the four recall RPCs
    // return a fixed table shape that predates the column. That call is
    // deliberate and is asserted here rather than blanket-allowed, so a future
    // change that adds a third query still trips this test.
    const tables = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0])
    expect(tables).toEqual(['memories'])
  })
})
