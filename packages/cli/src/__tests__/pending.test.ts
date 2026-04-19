import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as readline from 'readline'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
} from './helpers.js'

// vi.mock factories are hoisted — do not reference outer variables inside them.
// Use vi.hoisted() to share mutable state with tests.
const { mockIn, mockUpdate, mockChainData, mockChainError } = vi.hoisted(() => {
  const mockIn = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ in: mockIn, eq: vi.fn().mockReturnThis() })

  const mockChainData: unknown[] = []
  const mockChainError: { message: string } | null = null

  return { mockIn, mockUpdate, mockChainData, mockChainError }
})

// Mutable references so tests can swap the pending memories returned
let pendingMemories: unknown[] = []
let pendingError: { message: string } | null = null

vi.mock('@tages/shared', () => ({
  createSupabaseClient: vi.fn(() => mockSupabaseClient),
}))

// Build the supabase mock — `from()` chain for SELECT returns `pendingMemories` / `pendingError`
const selectChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  then: undefined as unknown,
}
Object.defineProperty(selectChain, 'then', {
  get() {
    return (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: pendingMemories, error: pendingError }).then(resolve)
  },
})

const mockSupabaseClient = {
  from: vi.fn().mockReturnValue({
    ...selectChain,
    update: mockUpdate,
  }),
  auth: {
    setSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't', refresh_token: 'r' } }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } }, error: null }),
  },
}

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

// Mock readline to avoid interactive prompts in tests
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('y')),
    close: vi.fn(),
  })),
}))

// Mock ora spinner
vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
  return { default: vi.fn(() => spinner) }
})

import { pendingCommand } from '../commands/pending.js'

describe('pending command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    // Reset pending data
    pendingMemories = []
    pendingError = null

    // Re-apply mocks after clearAllMocks
    mockIn.mockResolvedValue({ data: null, error: null })
    mockUpdate.mockReturnValue({ in: mockIn, eq: vi.fn().mockResolvedValue({ data: null, error: null }) })
    mockSupabaseClient.from.mockReturnValue({
      ...selectChain,
      update: mockUpdate,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('shows no memories message when queue is empty', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = []

    await pendingCommand({})

    expect(console_.logs.join('\n')).toContain('No memories pending review')
  })

  it('lists pending memories with confidence and tip footer', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'some-convention', type: 'convention', confidence: 0.7, created_at: '2026-04-18T00:00:00Z', tags: [] },
      { id: 'id-2', key: 'some-decision', type: 'decision', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('some-convention')
    expect(output).toContain('some-decision')
    expect(output).toContain('approve-all')
    expect(output).toContain('min-confidence')
  })

  it('--approve-all promotes all pending memories to live', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.7, created_at: '2026-04-18T00:00:00Z', tags: [] },
      { id: 'id-2', key: 'k2', type: 'decision', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ approveAll: true, yes: true })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'live' }),
    )
    expect(mockIn).toHaveBeenCalledWith('id', ['id-1', 'id-2'])
  })

  it('--approve-all with --min-confidence filters memories before bulk approve', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-low', key: 'k-low', type: 'lesson', confidence: 0.5, created_at: '2026-04-18T00:00:00Z', tags: [] },
      { id: 'id-high', key: 'k-high', type: 'convention', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ approveAll: true, minConfidence: '0.8', yes: true })

    // Only the high-confidence memory should be approved
    expect(mockIn).toHaveBeenCalledWith('id', ['id-high'])
    expect(mockIn).not.toHaveBeenCalledWith('id', expect.arrayContaining(['id-low']))
  })

  it('--approve-all with no matching memories (min-confidence too high) shows no-op message', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.5, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ approveAll: true, minConfidence: '0.99', yes: true })

    const output = console_.logs.join('\n')
    expect(output).toContain('No pending memories match')
    expect(mockIn).not.toHaveBeenCalled()
  })

  it('--reject-all archives all pending memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.7, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ rejectAll: true, yes: true })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' }),
    )
    expect(mockIn).toHaveBeenCalledWith('id', ['id-1'])
  })

  it('--stats shows confidence breakdown and session grouping', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: ['session-extract:abc123'] },
      { id: 'id-2', key: 'k2', type: 'decision', confidence: 0.6, created_at: '2026-04-18T00:00:00Z', tags: ['session-extract:abc123'] },
      { id: 'id-3', key: 'k3', type: 'lesson', confidence: 0.3, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ stats: true })

    const output = console_.logs.join('\n')
    expect(output).toContain('Total pending')
    expect(output).toContain('high confidence')
    expect(output).toContain('medium')
    expect(output).toContain('low')
    expect(output).toContain('session-extract:abc123')
  })

  it('--session filters by session tag', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    pendingMemories = [
      { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.8, created_at: '2026-04-18T00:00:00Z', tags: ['session-extract:sess-abc'] },
      { id: 'id-2', key: 'k2', type: 'decision', confidence: 0.7, created_at: '2026-04-18T00:00:00Z', tags: [] },
    ]

    await pendingCommand({ approveAll: true, session: 'sess-abc', yes: true })

    expect(mockIn).toHaveBeenCalledWith('id', ['id-1'])
  })

  it('--min-confidence rejects invalid values', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(pendingCommand({ minConfidence: 'notanumber' })).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('--min-confidence')

    exitSpy.mockRestore()
  })

  it('exits when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(pendingCommand({})).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
  })
})
