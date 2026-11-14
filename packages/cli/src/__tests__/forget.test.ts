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

// Mock the Supabase auth client used for cloud delete:
//   delete().eq(project_id).eq(key).select('id')   -> mockDeleteSelect
//   select('id').eq(project_id).eq(key)            -> mockProbeEq2 (existence probe)
const {
  mockDeleteSelect, mockDeleteEq2, mockDeleteEq1, mockDelete,
  mockProbeEq2, mockProbeEq1, mockProbeSelect,
  mockSupabaseClient, mockCreateAuthenticatedClient,
} = vi.hoisted(() => {
  const mockDeleteSelect = vi.fn().mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
  const mockDeleteEq2 = vi.fn().mockReturnValue({ select: mockDeleteSelect })
  const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 })
  const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 })
  const mockProbeEq2 = vi.fn().mockResolvedValue({ data: [], error: null })
  const mockProbeEq1 = vi.fn().mockReturnValue({ eq: mockProbeEq2 })
  const mockProbeSelect = vi.fn().mockReturnValue({ eq: mockProbeEq1 })
  const mockSupabaseClient = {
    from: vi.fn().mockReturnValue({ delete: mockDelete, select: mockProbeSelect }),
  }
  const mockCreateAuthenticatedClient = vi.fn().mockResolvedValue(mockSupabaseClient)
  return {
    mockDeleteSelect, mockDeleteEq2, mockDeleteEq1, mockDelete,
    mockProbeEq2, mockProbeEq1, mockProbeSelect,
    mockSupabaseClient, mockCreateAuthenticatedClient,
  }
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
    mockDeleteSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    mockDeleteEq2.mockReturnValue({ select: mockDeleteSelect })
    mockDeleteEq1.mockReturnValue({ eq: mockDeleteEq2 })
    mockDelete.mockReturnValue({ eq: mockDeleteEq1 })
    mockProbeEq2.mockResolvedValue({ data: [], error: null })
    mockProbeEq1.mockReturnValue({ eq: mockProbeEq2 })
    mockProbeSelect.mockReturnValue({ eq: mockProbeEq1 })
    mockSupabaseClient.from.mockReturnValue({ delete: mockDelete, select: mockProbeSelect })
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
    mockDeleteSelect.mockImplementation(async () => { callOrder.push('cloud'); return { data: [{ id: 'row-1' }], error: null } })

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

  it('cloud delete error exits 1 and says the shared store was not changed', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteSelect.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(forgetCommand('key', {})).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(mockDeleteByKey).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
    expect(console_.errors.join('\n')).toContain('permission denied')
    expect(console_.errors.join('\n')).toContain('shared store')
    expect(console_.logs.join('\n')).not.toContain('Deleted')
    exitSpy.mockRestore()
  })

  it('RLS-denied delete (0 rows, row still visible) exits 1, never prints Deleted', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteSelect.mockResolvedValue({ data: [], error: null })
    mockProbeEq2.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(forgetCommand('team-fact', {})).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toMatch(/Could not delete "team-fact" from the shared store/)
    expect(console_.errors.join('\n')).toContain('read-only')
    expect(console_.logs.join('\n')).not.toContain('Deleted')
    exitSpy.mockRestore()
  })

  it('0 rows deleted and no remote row (never synced) still succeeds', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteSelect.mockResolvedValue({ data: [], error: null })
    mockProbeEq2.mockResolvedValue({ data: [], error: null })

    await forgetCommand('local-only-key', {})

    expect(mockProbeSelect).toHaveBeenCalledWith('id')
    expect(console_.logs.join('\n')).toContain('Deleted')
  })

  it('chains .select() on the delete so zero rows are observable', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await forgetCommand('k', {})

    expect(mockDeleteSelect).toHaveBeenCalledWith('id')
  })

  it('builds the cloud client before the local delete (dead session deletes nothing)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockCreateAuthenticatedClient.mockImplementation(async () => {
      throw new Error('process.exit called')
    })

    await expect(forgetCommand('k', {})).rejects.toThrow('process.exit called')

    expect(mockDeleteByKey).not.toHaveBeenCalled()
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

  it('always calls close() even when cloud delete throws, and exits 1', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockDeleteSelect.mockRejectedValue(new Error('network error'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(forgetCommand('key', {})).rejects.toThrow('process.exit called')

    expect(mockDeleteByKey).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
    expect(console_.errors.join('\n')).toContain('network error')
    exitSpy.mockRestore()
  })

  it('uses --project flag to look up config', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG, slug: 'other-proj' })

    await forgetCommand('key', { project: 'other-proj' })

    expect(console_.logs.join('\n')).toContain('Deleted')
  })
})
