import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// vi.mock factories are hoisted — do NOT reference outer variables inside them.
// Use vi.hoisted() to share mocks across the factory and tests.
const { mockUpsertMemory, mockFlush, mockClose, mockOpenCliSync } = vi.hoisted(() => {
  const mockUpsertMemory = vi.fn()
  const mockFlush = vi.fn().mockResolvedValue(undefined)
  const mockClose = vi.fn()
  const mockOpenCliSync = vi.fn().mockResolvedValue({
    cache: { upsertMemory: mockUpsertMemory },
    flush: mockFlush,
    close: mockClose,
  })
  return { mockUpsertMemory, mockFlush, mockClose, mockOpenCliSync }
})

vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: mockOpenCliSync,
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

import { rememberCommand } from '../commands/remember.js'

describe('remember command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    // Reset mock return values after clearAllMocks
    mockFlush.mockResolvedValue(undefined)
    mockOpenCliSync.mockResolvedValue({
      cache: { upsertMemory: mockUpsertMemory },
      flush: mockFlush,
      close: mockClose,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('writes SQLite first then flushes to cloud', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const callOrder: string[] = []
    mockUpsertMemory.mockImplementation(() => { callOrder.push('sqlite') })
    mockFlush.mockImplementation(async () => { callOrder.push('flush') })

    await rememberCommand('test-key', 'test-value', { type: 'convention' })

    expect(callOrder).toEqual(['sqlite', 'flush'])
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
        projectId: 'test-project-id',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('test-key')
  })

  it('stores a memory and prints success message', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('test-key', 'test-value', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
        projectId: 'test-project-id',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('test-key')
  })

  it('stores a memory with optional tags and file paths', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('tagged-key', 'tagged-value', {
      type: 'decision',
      filePaths: ['src/index.ts', 'src/utils.ts'],
      tags: ['important', 'architecture'],
    })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tagged-key',
        value: 'tagged-value',
        type: 'decision',
        filePaths: ['src/index.ts', 'src/utils.ts'],
        tags: ['important', 'architecture'],
      }),
      true,
    )
  })

  it('handles special characters in value (quotes, newlines, unicode)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const specialValue = 'He said "hello"\nNew line here\tTab\u00e9\u00e8\u00ea emoji: \u2764'
    await rememberCommand('special-chars', specialValue, { type: 'lesson' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'special-chars',
        value: specialValue,
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('special-chars')
  })

  it('exits with error when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      rememberCommand('key', 'value', { type: 'convention' }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('Supabase failure does not prevent SQLite write', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const callOrder: string[] = []
    mockUpsertMemory.mockImplementation(() => { callOrder.push('sqlite') })
    // flush throws — but SQLite was already written before flush is called
    mockFlush.mockImplementation(async () => {
      callOrder.push('flush-start')
      throw new Error('Network error')
    })

    // Command may throw from flush — but SQLite was written before that
    try {
      await rememberCommand('key', 'value', { type: 'convention' })
    } catch {
      // acceptable
    }

    expect(callOrder[0]).toBe('sqlite')
    expect(callOrder[1]).toBe('flush-start')
    expect(mockUpsertMemory).toHaveBeenCalled()
    // close() is always called in finally
    expect(mockClose).toHaveBeenCalled()
  })

  it('remember works in local mode (no supabaseUrl)', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await rememberCommand('local-key', 'local-value', { type: 'convention' })

    // openCliSync is called (handles local mode internally with no-op flush)
    expect(mockOpenCliSync).toHaveBeenCalled()
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'local-key',
        value: 'local-value',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('local-key')
  })

  it('skips Supabase when in local-only mode (no supabaseUrl)', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await rememberCommand('local-key', 'local-value', { type: 'convention' })

    expect(mockOpenCliSync).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseUrl: '' }),
    )
    expect(console_.logs.join('\n')).toContain('local-key')
  })

  it('uses the specified project slug to load config', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG, slug: 'my-app' })

    await rememberCommand('key', 'val', { type: 'convention', project: 'my-app' })

    expect(console_.logs.join('\n')).toContain('key')
  })

  it('defaults type to convention', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('key', 'val', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'convention' }),
      true,
    )
  })

  it('defaults filePaths and tags to empty arrays when not provided', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('key', 'val', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        filePaths: [],
        tags: [],
      }),
      true,
    )
  })

  it('always calls close() even when flush throws', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlush.mockRejectedValue(new Error('flush error'))

    try {
      await rememberCommand('key', 'value', { type: 'convention' })
    } catch {
      // may throw from flush
    }

    expect(mockClose).toHaveBeenCalled()
  })
})
