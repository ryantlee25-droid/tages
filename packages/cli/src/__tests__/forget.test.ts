import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

const mockDeleteEq2 = vi.fn()
const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 })
const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 })
const mockSupabase = {
  from: vi.fn().mockReturnValue({ delete: mockDelete }),
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

import { forgetCommand } from '../commands/forget.js'

describe('forget command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    // Reset the chain
    mockDeleteEq2.mockResolvedValue({ data: null, error: null })
    mockDeleteEq1.mockReturnValue({ eq: mockDeleteEq2 })
    mockDelete.mockReturnValue({ eq: mockDeleteEq1 })
    mockSupabase.from.mockReturnValue({ delete: mockDelete })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('deletes a memory by key and prints success', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await forgetCommand('old-convention', {})

    expect(mockSupabase.from).toHaveBeenCalledWith('memories')
    expect(mockDeleteEq1).toHaveBeenCalledWith('project_id', 'test-project-id')
    expect(mockDeleteEq2).toHaveBeenCalledWith('key', 'old-convention')
    expect(console_.logs.join('\n')).toContain('Deleted')
    expect(console_.logs.join('\n')).toContain('old-convention')
  })

  it('succeeds silently when deleting a non-existent key (Supabase returns no error)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    // Supabase DELETE on a non-existent row returns success with no error
    mockDeleteEq2.mockResolvedValue({ data: null, error: null })

    await forgetCommand('does-not-exist', {})

    // The CLI still prints "Deleted" because Supabase doesn't error on missing rows
    expect(console_.logs.join('\n')).toContain('Deleted')
    expect(console_.logs.join('\n')).toContain('does-not-exist')
  })

  it('reports Supabase delete errors', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteEq2.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      forgetCommand('key', {}),
    ).rejects.toThrow('process.exit called')

    expect(console_.errors.join('\n')).toContain('permission denied')
    exitSpy.mockRestore()
  })

  it('exits with error when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      forgetCommand('key', {}),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('skips Supabase in local-only mode', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await forgetCommand('key', {})

    // from() should not be called since there's no supabaseUrl
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(console_.logs.join('\n')).toContain('Deleted')
  })

  it('uses --project flag to look up config', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG, slug: 'other-proj' })

    await forgetCommand('key', { project: 'other-proj' })

    expect(console_.logs.join('\n')).toContain('Deleted')
  })
})
