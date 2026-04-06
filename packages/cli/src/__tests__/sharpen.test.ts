import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setupTempConfigDir,
  writeProjectConfig,
  writeAuthConfig,
  createMockSupabaseClient,
  captureConsole,
} from './helpers.js'

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: vi.fn(),
}))

vi.mock('../config/project.js', () => ({
  loadProjectConfig: vi.fn(),
}))

vi.mock('../indexer/sharpen-client.js', () => ({
  sharpenMemory: vi.fn(),
}))

const mockMemoryRow = {
  id: 'id-1',
  project_id: 'test-project-id',
  key: 'supabase-wrap',
  value: 'Supabase returns PromiseLike not Promise',
  type: 'lesson',
  source: 'manual',
  status: 'live',
  confidence: 1.0,
  file_paths: [],
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

describe('sharpenCommand — single key', () => {
  let configDir: string
  let cleanup: () => void

  beforeEach(() => {
    const setup = setupTempConfigDir()
    configDir = setup.configDir
    cleanup = setup.cleanup
    writeProjectConfig(configDir)
    writeAuthConfig(configDir)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('--yes flag skips readline prompt and applies rewrite', async () => {
    const { loadProjectConfig } = await import('../config/project.js')
    const { createAuthenticatedClient } = await import('../auth/session.js')
    const { sharpenMemory } = await import('../indexer/sharpen-client.js')

    vi.mocked(loadProjectConfig).mockReturnValue({
      projectId: 'test-project-id',
      slug: 'test-project',
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    } as ReturnType<typeof loadProjectConfig>)

    const rewritten = 'ALWAYS wrap Supabase calls with Promise.resolve() for .catch() support.'
    vi.mocked(sharpenMemory).mockResolvedValue(rewritten)

    vi.mocked(createAuthenticatedClient).mockResolvedValue(
      createMockSupabaseClient({ singleData: mockMemoryRow }) as unknown as Awaited<ReturnType<typeof createAuthenticatedClient>>
    )

    const consoleCap = captureConsole()

    const { sharpenCommand } = await import('../commands/sharpen.js')
    await sharpenCommand('supabase-wrap', { yes: true })

    consoleCap.restore()

    const output = consoleCap.logs.join('\n')
    expect(output).toContain('Before:')
    expect(output).toContain('After:')
    expect(output).toContain('Applied')

    // readline should NOT have been called (--yes skips prompt)
    expect(sharpenMemory).toHaveBeenCalledWith('supabase-wrap', expect.any(String), expect.any(String))
  })
})

describe('sharpenCommand — --all mode', () => {
  let configDir: string
  let cleanup: () => void

  beforeEach(() => {
    const setup = setupTempConfigDir()
    configDir = setup.configDir
    cleanup = setup.cleanup
    writeProjectConfig(configDir)
    writeAuthConfig(configDir)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('--all iterates only un-sharpened candidates without imperative phrasing', async () => {
    const { loadProjectConfig } = await import('../config/project.js')
    const { createAuthenticatedClient } = await import('../auth/session.js')
    const { sharpenMemory } = await import('../indexer/sharpen-client.js')

    vi.mocked(loadProjectConfig).mockReturnValue({
      projectId: 'test-project-id',
      slug: 'test-project',
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    } as ReturnType<typeof loadProjectConfig>)

    const rows = [
      // candidate: lesson, no imperative, no sharpened tag
      { ...mockMemoryRow, id: 'id-1', key: 'ls1', value: 'Supabase is slow', type: 'lesson', tags: [] },
      // already sharpened — should be excluded
      { ...mockMemoryRow, id: 'id-2', key: 'ls2', value: 'Supabase is slow', type: 'lesson', tags: ['sharpened'] },
      // already imperative — should be excluded
      { ...mockMemoryRow, id: 'id-3', key: 'ls3', value: 'ALWAYS wrap with Promise.resolve()', type: 'lesson', tags: [] },
      // convention candidate
      { ...mockMemoryRow, id: 'id-4', key: 'cv1', value: 'Named exports preferred', type: 'convention', tags: [] },
    ]

    vi.mocked(createAuthenticatedClient).mockResolvedValue(
      createMockSupabaseClient({ selectData: rows }) as unknown as Awaited<ReturnType<typeof createAuthenticatedClient>>
    )

    vi.mocked(sharpenMemory).mockResolvedValue('ALWAYS use named exports.')

    const consoleCap = captureConsole()

    const { sharpenCommand } = await import('../commands/sharpen.js')
    await sharpenCommand(undefined, { all: true, yes: true })

    consoleCap.restore()

    // Should only process 2 candidates: ls1 and cv1
    expect(sharpenMemory).toHaveBeenCalledTimes(2)
  })
})
