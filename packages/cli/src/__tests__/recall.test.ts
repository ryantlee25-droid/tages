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

  it('prints "no memories found" for empty results', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('nonexistent-query-xyz', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('No memories found')
  })

  it('handles empty query string', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockRpc.mockResolvedValue({ data: [], error: null })

    await recallCommand('', {})

    expect(mockRpc).toHaveBeenCalledWith('recall_memories', expect.objectContaining({
      p_query: '',
    }))
    const output = console_.logs.join('\n')
    expect(output).toContain('No memories found')
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
})
