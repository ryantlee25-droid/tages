import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// Mock fetch globally (for Ollama embedding calls)
const originalFetch = globalThis.fetch
beforeEach(() => {
  // Default: Ollama not available
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

// Mock Supabase
const mockRpc = vi.fn()
const mockSupabase = {
  from: vi.fn(),
  rpc: mockRpc,
}
vi.mock('@tages/shared', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
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
      p_limit: 5,
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

  it('respects --limit option', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', { limit: '2' })

    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_limit: 2,
    }))
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

    // Simulate Ollama being available
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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
    process.env.OPENAI_API_KEY = 'test-openai-key'
    // No TAGES_OPENAI_EMBED opt-in — the paid fallback must stay off.

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
    expect(output).toContain('hybrid (trigram + semantic)')
    expect(output).toContain('opt-in-key')

    delete process.env.OPENAI_API_KEY
    delete process.env.TAGES_OPENAI_EMBED
  })

  it('drops a near-duplicate content result while keeping distinct results (Task 4 content dedup)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // Simulate Ollama being available so the semantic path runs.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: new Array(768).fill(0.1) }),
    })

    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('test', {})

    expect(mockRpc).toHaveBeenCalledWith('semantic_recall', expect.objectContaining({
      p_threshold: 0.3,
    }))
  })
})
