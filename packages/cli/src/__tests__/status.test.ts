import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// Build a mock Supabase chain that supports .from().select().eq() as PromiseLike
const mockSelectData: unknown[] = []
let mockSelectError: { message: string } | null = null

const mockChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  then: undefined as unknown,
}
// Make it thenable so `await supabase.from().select().eq()` resolves
Object.defineProperty(mockChain, 'then', {
  get() {
    return (resolve: (val: unknown) => void) =>
      Promise.resolve({ data: mockSelectData, error: mockSelectError }).then(resolve)
  },
})

const mockSupabase = {
  from: vi.fn().mockReturnValue(mockChain),
  rpc: vi.fn(),
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

import { statusCommand } from '../commands/status.js'

describe('status command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
    // Reset mock data
    mockSelectData.length = 0
    mockSelectError = null
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('displays project slug and mode', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockSelectData.push(
      { type: 'convention' },
      { type: 'convention' },
      { type: 'decision' },
    )

    await statusCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Tages Status')
    expect(output).toContain('test-project')
    expect(output).toContain('Cloud')
  })

  it('shows memory counts by type', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockSelectData.push(
      { type: 'convention' },
      { type: 'convention' },
      { type: 'architecture' },
      { type: 'decision' },
    )

    await statusCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('4')
    expect(output).toContain('convention: 2')
    expect(output).toContain('architecture: 1')
    expect(output).toContain('decision: 1')
  })

  it('shows local-only mode when no Supabase config', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await statusCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Local-only')
  })

  it('exits with error when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(statusCommand({})).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('handles Supabase select errors gracefully', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockSelectError = { message: 'timeout' }

    await statusCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('failed to fetch')
  })

  it('shows cache info when cache file exists', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    // Create a fake cache file
    const cacheDir = path.join(tempConfigDir, 'cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'test-project.db'), 'fake-db-content')

    await statusCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Cache:')
    expect(output).toContain('KB')
  })
})
