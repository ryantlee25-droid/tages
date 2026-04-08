import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// vi.mock factories are hoisted — use vi.hoisted() to share mocks.
const { mockDeleteByKey, mockClose, mockFlush, mockOpenCliSync } = vi.hoisted(() => {
  const mockDeleteByKey = vi.fn().mockReturnValue(true)
  const mockClose = vi.fn()
  const mockFlush = vi.fn().mockResolvedValue(undefined)
  const mockOpenCliSync = vi.fn().mockResolvedValue({
    cache: { deleteByKey: mockDeleteByKey },
    flush: mockFlush,
    close: mockClose,
  })
  return { mockDeleteByKey, mockClose, mockFlush, mockOpenCliSync }
})

vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: mockOpenCliSync,
}))

// Mock the Supabase auth client used for cloud delete
const { mockDeleteEq2, mockDeleteEq1, mockDelete, mockSupabaseClient, mockCreateAuthenticatedClient } = vi.hoisted(() => {
  const mockDeleteEq2 = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 })
  const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 })
  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue({ delete: mockDelete }),
  }
  const mockCreateAuthenticatedClient = vi.fn().mockResolvedValue(mockSupabaseClient)
  return { mockDeleteEq2, mockDeleteEq1, mockDelete, mockSupabaseClient, mockCreateAuthenticatedClient }
})

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mockCreateAuthenticatedClient,
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

    // Reset mocks after clearAllMocks
    mockDeleteByKey.mockReturnValue(true)
    mockFlush.mockResolvedValue(undefined)
    mockDeleteEq2.mockResolvedValue({ data: null, error: null })
    mockDeleteEq1.mockReturnValue({ eq: mockDeleteEq2 })
    mockDelete.mockReturnValue({ eq: mockDeleteEq1 })
    mockSupabaseClient.from.mockReturnValue({ delete: mockDelete })
    mockCreateAuthenticatedClient.mockResolvedValue(mockSupabaseClient)
    mockOpenCliSync.mockResolvedValue({
      cache: { deleteByKey: mockDeleteByKey },
      flush: mockFlush,
      close: mockClose,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('deletes SQLite first then cloud', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const callOrder: string[] = []
    mockDeleteByKey.mockImplementation(() => { callOrder.push('sqlite'); return true })
    mockDeleteEq2.mockImplementation(async () => { callOrder.push('cloud'); return { data: null, error: null } })

    await forgetCommand('old-convention', {})

    expect(callOrder[0]).toBe('sqlite')
    expect(callOrder[1]).toBe('cloud')
    expect(mockDeleteByKey).toHaveBeenCalledWith('test-project-id', 'old-convention')
    expect(console_.logs.join('\n')).toContain('Deleted')
    expect(console_.logs.join('\n')).toContain('old-convention')
  })

  it('deletes a memory by key and prints success', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await forgetCommand('old-convention', {})

    expect(mockDeleteByKey).toHaveBeenCalledWith('test-project-id', 'old-convention')
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('memories')
    expect(mockDeleteEq1).toHaveBeenCalledWith('project_id', 'test-project-id')
    expect(mockDeleteEq2).toHaveBeenCalledWith('key', 'old-convention')
    expect(console_.logs.join('\n')).toContain('Deleted')
    expect(console_.logs.join('\n')).toContain('old-convention')
  })

  it('succeeds silently when deleting a non-existent key (SQLite returns false)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteByKey.mockReturnValue(false)

    await forgetCommand('does-not-exist', {})

    expect(console_.logs.join('\n')).toContain('Deleted')
    expect(console_.logs.join('\n')).toContain('does-not-exist')
  })

  it('cloud delete error is a warning only — does not exit', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteEq2.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    })

    // Should NOT throw — cloud errors are best-effort warnings
    await forgetCommand('key', {})

    expect(mockDeleteByKey).toHaveBeenCalled()
    expect(console_.errors.join('\n')).toContain('permission denied')
    expect(console_.logs.join('\n')).toContain('Deleted')
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

    // Supabase client should not be called since supabaseUrl is empty
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
    expect(mockDeleteByKey).toHaveBeenCalled()
    expect(console_.logs.join('\n')).toContain('Deleted')
  })

  it('always calls close() even when cloud delete throws', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteEq2.mockRejectedValue(new Error('network error'))

    await forgetCommand('key', {})

    expect(mockDeleteByKey).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
    expect(console_.errors.join('\n')).toContain('network error')
    expect(console_.logs.join('\n')).toContain('Deleted')
  })

  it('reports Supabase delete errors as warnings (no process.exit)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteEq2.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    })

    // Should complete without throwing
    await forgetCommand('key', {})

    expect(console_.errors.join('\n')).toContain('permission denied')
    expect(console_.logs.join('\n')).toContain('Deleted')
  })

  it('uses --project flag to look up config', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG, slug: 'other-proj' })

    await forgetCommand('key', { project: 'other-proj' })

    expect(console_.logs.join('\n')).toContain('Deleted')
  })
})
