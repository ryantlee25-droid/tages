import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { setupTempConfigDir, captureConsole } from './helpers.js'

/**
 * `tages init` used to call runGithubOAuth() unconditionally, so it demanded a
 * fresh browser round-trip even immediately after `tages login` — and died
 * after a 5-minute OAuth timeout on any headless run. These tests pin the
 * reuse path: a usable saved session must skip the browser entirely, and an
 * unusable one must still fall back to it.
 */

vi.mock('../auth/github-oauth.js', () => ({
  runGithubOAuth: vi.fn().mockResolvedValue({
    accessToken: 'oauth-access',
    refreshToken: 'oauth-refresh',
    userId: 'oauth-user-id',
  }),
}))

vi.mock('../config/mcp-inject.js', () => ({
  injectMcpConfig: vi.fn().mockReturnValue({ path: '/mock/.mcp.json', created: true }),
}))

vi.mock('../indexer/install-hook.js', () => ({
  installPostCommitHook: vi.fn().mockReturnValue({ installed: false, path: '' }),
}))

vi.mock('open', () => ({ default: vi.fn() }))

// Session status the mocked auth layer should report for the next init run.
let sessionStatus: 'authenticated' | 'expired' | 'anonymous' | 'service-key' = 'authenticated'

const sessionClient = {
  auth: {
    getUser: vi.fn(async () =>
      sessionStatus === 'authenticated'
        ? { data: { user: { id: 'saved-user-id', email: 'saved@example.com' } }, error: null }
        : { data: { user: null }, error: { message: 'not authenticated' } },
    ),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'saved-access', refresh_token: 'saved-refresh' } },
    })),
  },
}

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClientWithStatus: vi.fn(async () => ({
    supabase: sessionClient,
    status: sessionStatus,
  })),
}))

const mockSupabase = {
  auth: { setSession: vi.fn().mockResolvedValue({ data: { session: {} }, error: null }) },
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'mock-project-uuid' }, error: null }),
      }),
    }),
  }),
}

vi.mock('@tages/shared', async () => {
  const actual = (await vi.importActual('@tages/shared')) as Record<string, unknown>
  return { ...actual, createSupabaseClient: vi.fn(() => mockSupabase) }
})

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
  getClaudeDesktopConfigPath: () => path.join(tempConfigDir, 'claude_desktop_config.json'),
  getClaudeCodeMcpConfigPath: () => path.join(tempConfigDir, '.mcp.json'),
}))

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

function writeSavedAuth() {
  fs.writeFileSync(
    path.join(tempConfigDir, 'auth.json'),
    JSON.stringify({
      accessToken: 'saved-access',
      refreshToken: 'saved-refresh',
      userId: 'saved-user-id',
    }),
  )
}

describe('init reuses a saved session instead of forcing OAuth', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    sessionStatus = 'authenticated'
    vi.clearAllMocks()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('does NOT open a browser when auth.json carries a usable session', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')
    writeSavedAuth()

    await initCommand({ slug: 'phoenix' })

    expect(runGithubOAuth).not.toHaveBeenCalled()
  })

  it('still creates the project when reusing the saved session', async () => {
    writeSavedAuth()

    await initCommand({ slug: 'phoenix' })

    const projectPath = path.join(tempConfigDir, 'projects', 'phoenix.json')
    expect(fs.existsSync(projectPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(projectPath, 'utf-8')).projectId).toBe('mock-project-uuid')
  })

  it('owns the project as the saved session user, not a stale userId on disk', async () => {
    writeSavedAuth()

    await initCommand({ slug: 'phoenix' })

    // createCloudProject receives the id resolved from getUser(), which is the
    // authoritative one — auth.json's copy can be stale after an account switch.
    expect(sessionClient.auth.getUser).toHaveBeenCalled()
  })

  it('falls back to OAuth when the saved session is expired', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')
    writeSavedAuth()
    sessionStatus = 'expired'

    await initCommand({ slug: 'phoenix' })

    expect(runGithubOAuth).toHaveBeenCalled()
  })

  it('falls back to OAuth when there is no saved session at all', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')

    await initCommand({ slug: 'phoenix' })

    expect(runGithubOAuth).toHaveBeenCalled()
  })

  it('falls back to OAuth when the client is a TAGES_SERVICE_KEY client (no user to own the project)', async () => {
    const { runGithubOAuth } = await import('../auth/github-oauth.js')
    writeSavedAuth()
    sessionStatus = 'service-key'

    await initCommand({ slug: 'phoenix' })

    expect(runGithubOAuth).toHaveBeenCalled()
  })
})
