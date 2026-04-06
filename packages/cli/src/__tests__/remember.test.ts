import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  createMockSupabaseClient,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// Mock @tages/shared before importing the command
const mockSupabase = createMockSupabaseClient()
vi.mock('@tages/shared', () => ({
  createSupabaseClient: vi.fn(() => mockSupabase),
}))

// Mock config/paths to point at our temp dir
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

    // Reset mock state
    vi.clearAllMocks()
    mockSupabase.from = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('stores a memory and prints success message', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('test-key', 'test-value', { type: 'convention' })

    expect(mockSupabase.from).toHaveBeenCalledWith('memories')
    const upsertCall = mockSupabase.from.mock.results[0].value.upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
        project_id: 'test-project-id',
      }),
      { onConflict: 'project_id,key' },
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

    const upsertCall = mockSupabase.from.mock.results[0].value.upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tagged-key',
        value: 'tagged-value',
        type: 'decision',
        file_paths: ['src/index.ts', 'src/utils.ts'],
        tags: ['important', 'architecture'],
      }),
      expect.any(Object),
    )
  })

  it('handles special characters in value (quotes, newlines, unicode)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const specialValue = 'He said "hello"\nNew line here\tTab\u00e9\u00e8\u00ea emoji: \u2764'
    await rememberCommand('special-chars', specialValue, { type: 'lesson' })

    const upsertCall = mockSupabase.from.mock.results[0].value.upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'special-chars',
        value: specialValue,
      }),
      expect.any(Object),
    )
    expect(console_.logs.join('\n')).toContain('special-chars')
  })

  it('exits with error when no project is configured', async () => {
    // Don't write any project config -- the directory exists but is empty
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

  it('reports Supabase upsert errors', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockSupabase.from = vi.fn().mockReturnValue({
      upsert: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Row too large' },
      }),
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      rememberCommand('key', 'value', { type: 'convention' }),
    ).rejects.toThrow('process.exit called')

    expect(console_.errors.join('\n')).toContain('Row too large')
    exitSpy.mockRestore()
  })

  it('skips Supabase when in local-only mode (no supabaseUrl)', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await rememberCommand('local-key', 'local-value', { type: 'convention' })

    // Supabase should NOT be called in local-only mode
    expect(mockSupabase.from).not.toHaveBeenCalled()
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

    const upsertCall = mockSupabase.from.mock.results[0].value.upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'convention' }),
      expect.any(Object),
    )
  })

  it('defaults filePaths and tags to empty arrays when not provided', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('key', 'val', { type: 'convention' })

    const upsertCall = mockSupabase.from.mock.results[0].value.upsert
    expect(upsertCall).toHaveBeenCalledWith(
      expect.objectContaining({
        file_paths: [],
        tags: [],
      }),
      expect.any(Object),
    )
  })
})
