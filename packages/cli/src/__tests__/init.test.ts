import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  setupTempConfigDir,
  captureConsole,
} from './helpers.js'

// Mock the OAuth module to avoid actually opening a browser
vi.mock('../auth/github-oauth.js', () => ({
  runGithubOAuth: vi.fn().mockResolvedValue({
    accessToken: 'mock-access',
    refreshToken: 'mock-refresh',
    userId: 'mock-user-id',
  }),
}))

// Mock the MCP inject module
const mockInjectMcpConfig = vi.fn().mockReturnValue({
  path: '/mock/mcp/config.json',
  created: true,
})
vi.mock('../config/mcp-inject.js', () => ({
  injectMcpConfig: (...args: unknown[]) => mockInjectMcpConfig(...args),
}))

// Mock open (browser launcher)
vi.mock('open', () => ({ default: vi.fn() }))

// Mock @tages/shared — createSupabaseClient for cloud init
const mockSupabase = {
  auth: {
    setSession: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }),
  },
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'mock-project-uuid' },
          error: null,
        }),
      }),
    }),
  }),
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
  getClaudeDesktopConfigPath: () => path.join(tempConfigDir, 'claude_desktop_config.json'),
}))

// Mock ora to avoid spinner noise
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

import { initCommand } from '../commands/init.js'

describe('init command', () => {
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

  it('creates project config in local-only mode', async () => {
    await initCommand({ local: true, slug: 'my-app' })

    const projectPath = path.join(tempConfigDir, 'projects', 'my-app.json')
    expect(fs.existsSync(projectPath)).toBe(true)

    const config = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    expect(config.projectId).toBe('local-my-app')
    expect(config.slug).toBe('my-app')
    expect(config.supabaseUrl).toBe('')
    expect(config.supabaseAnonKey).toBe('')
  })

  it('calls injectMcpConfig in local-only mode', async () => {
    await initCommand({ local: true, slug: 'test-app' })

    expect(mockInjectMcpConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'local-test-app',
        projectSlug: 'test-app',
      }),
    )
  })

  it('is idempotent -- running init twice overwrites the config cleanly', async () => {
    // First init
    await initCommand({ local: true, slug: 'idem-app' })
    const projectPath = path.join(tempConfigDir, 'projects', 'idem-app.json')
    const firstConfig = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))

    // Second init -- should overwrite, not error
    await initCommand({ local: true, slug: 'idem-app' })
    const secondConfig = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))

    expect(secondConfig.slug).toBe('idem-app')
    expect(secondConfig.projectId).toBe(firstConfig.projectId)
  })

  it('creates the config and projects directories if they do not exist', async () => {
    // Remove the directories created by setup
    fs.rmSync(tempConfigDir, { recursive: true, force: true })
    fs.mkdirSync(tempConfigDir) // Re-create just the base (no projects/ subdir)

    await initCommand({ local: true, slug: 'fresh' })

    const projectsDir = path.join(tempConfigDir, 'projects')
    expect(fs.existsSync(projectsDir)).toBe(true)
    expect(fs.existsSync(path.join(projectsDir, 'fresh.json'))).toBe(true)
  })

  it('uses directory name as slug when --slug is not provided', async () => {
    // basename of cwd will be used
    await initCommand({ local: true })

    const projectsDir = path.join(tempConfigDir, 'projects')
    const files = fs.readdirSync(projectsDir)
    expect(files.length).toBe(1)
    // The slug will be the basename of process.cwd()
    const expectedSlug = path.basename(process.cwd())
    expect(files[0]).toBe(`${expectedSlug}.json`)
  })

  it('runs cloud OAuth flow when not in local mode', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')

    await initCommand({ slug: 'cloud-app' })

    expect(runGithubOAuth).toHaveBeenCalled()

    // Auth file should be written
    const authPath = path.join(tempConfigDir, 'auth.json')
    expect(fs.existsSync(authPath)).toBe(true)
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    expect(auth.accessToken).toBe('mock-access')

    // Project config should be written with real Supabase creds
    const projectPath = path.join(tempConfigDir, 'projects', 'cloud-app.json')
    expect(fs.existsSync(projectPath)).toBe(true)
    const config = JSON.parse(fs.readFileSync(projectPath, 'utf-8'))
    expect(config.projectId).toBe('mock-project-uuid')
    expect(config.supabaseUrl).toContain('supabase.co')
  })

  it('handles OAuth failure gracefully', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')
    vi.mocked(runGithubOAuth).mockRejectedValueOnce(new Error('Browser closed'))

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      initCommand({ slug: 'fail-app' }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('Browser closed')
    exitSpy.mockRestore()
  })
})
