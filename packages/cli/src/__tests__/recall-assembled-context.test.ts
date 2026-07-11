import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
} from './helpers.js'

const originalFetch = globalThis.fetch
beforeEach(() => {
  // Ollama down by default -> trigram-only path, deterministic RPC call count.
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

const mockRpc = vi.fn()
const mockSupabase = {
  from: vi.fn(),
  rpc: mockRpc,
}
vi.mock('@tages/shared', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
}))

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

describe('recall --assembled-context (Task 4)', () => {
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

  const twoDatedRows = [
    {
      id: 'older',
      key: 'older-key',
      value: 'An older dated memory.',
      type: 'lesson',
      similarity: 0.7,
      referenced_date: '2026-01-01T00:00:00.000Z',
      relative_date: null,
    },
    {
      id: 'newer',
      key: 'newer-key',
      value: 'A newer dated memory.',
      type: 'lesson',
      similarity: 0.9,
      referenced_date: '2026-07-01T00:00:00.000Z',
      relative_date: null,
    },
  ]

  it('outputs one deduped, chronologically-ordered, date-prefixed block when the flag is set', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: twoDatedRows, error: null })

    await recallCommand('memories', { assembledContext: true })

    const output = console_.logs.join('\n')
    expect(output).toContain('Assembled context:')
    expect(output).not.toContain('Found 2 memories')
    // Chronological: older date appears before newer date in the output.
    const olderIdx = output.indexOf('older-key')
    const newerIdx = output.indexOf('newer-key')
    expect(olderIdx).toBeGreaterThan(-1)
    expect(newerIdx).toBeGreaterThan(-1)
    expect(olderIdx).toBeLessThan(newerIdx)
    // Date-prefixed entries.
    expect(output).toContain('[2026-01-01]')
    expect(output).toContain('[2026-07-01]')
  })

  it('trims entries once the token budget is exceeded', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    process.env.TAGES_ASSEMBLED_CONTEXT_TOKEN_BUDGET = '5'
    mockRpc.mockResolvedValue({ data: twoDatedRows, error: null })

    await recallCommand('memories', { assembledContext: true })

    const output = console_.logs.join('\n')
    // Budget is tiny (5 tokens ~= 20 chars) -> only the first entry fits.
    expect(output).toContain('older-key')
    expect(output).not.toContain('newer-key')

    delete process.env.TAGES_ASSEMBLED_CONTEXT_TOKEN_BUDGET
  })

  it('produces the exact same output whether the flag is omitted or explicitly false (default path untouched)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: twoDatedRows, error: null })

    await recallCommand('memories', {})
    const withoutFlag = [...console_.logs]

    console_.logs.length = 0
    mockRpc.mockClear()
    mockRpc.mockResolvedValue({ data: twoDatedRows, error: null })

    await recallCommand('memories', { assembledContext: false })
    const withExplicitFalse = [...console_.logs]

    expect(withExplicitFalse).toEqual(withoutFlag)
  })

  it('the default (no flag) output is the standard numbered-passage format, and parseRecallKeys-relevant markers are present', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: twoDatedRows, error: null })

    await recallCommand('memories', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('Found 2 memories')
    expect(output).not.toContain('Assembled context:')
  })
})
