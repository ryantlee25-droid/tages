import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { setupTempConfigDir, captureConsole, writeAuthConfig } from './helpers.js'

// `tages link --project-id` and `tages init` on an unparsable .mcp.json:
// exit 1, a clear message naming the file, no stack trace, the file untouched,
// and nothing else written (no project config, no .tages/config.json marker).

const mocks = vi.hoisted(() => ({
  runGithubOAuth: vi.fn(),
  createAuthenticatedClient: vi.fn(),
  createAuthenticatedClientWithStatus: vi.fn(),
  findMemberProjectById: vi.fn(),
  installPostCommitHook: vi.fn(() => ({ installed: false, path: '' })),
  createCloudProject: vi.fn(),
}))

vi.mock('../auth/github-oauth.js', () => ({ runGithubOAuth: mocks.runGithubOAuth }))

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mocks.createAuthenticatedClient,
  createAuthenticatedClientWithStatus: mocks.createAuthenticatedClientWithStatus,
}))

vi.mock('../../../shared/src/project-factory.js', () => ({
  findMemberProjectById: mocks.findMemberProjectById,
}))

vi.mock('../indexer/install-hook.js', () => ({ installPostCommitHook: mocks.installPostCommitHook }))

vi.mock('@tages/shared', async () => {
  const actual = await vi.importActual('@tages/shared') as Record<string, unknown>
  return { ...actual, createCloudProject: mocks.createCloudProject }
})

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  }
  return { default: vi.fn(() => spinner) }
})

let tempConfigDir: string

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
  getClaudeDesktopConfigPath: () => path.join(tempConfigDir, 'claude_desktop_config.json'),
  getClaudeCodeMcpConfigPath: () => path.join(process.cwd(), '.mcp.json'),
}))

import { linkCommand } from '../commands/link.js'
import { initCommand } from '../commands/init.js'
import { assertMcpConfigParsable, McpConfigParseError } from '../config/mcp-inject.js'

const GARBAGE = '{ "mcpServers": { "other": { "command": "x", } ,,, not json'

describe('unparsable .mcp.json', () => {
  let cleanupConfigDir: () => void
  let console_: ReturnType<typeof captureConsole>
  let workDir: string
  let origCwd: string
  let origServiceKey: string | undefined
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupConfigDir = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
    origServiceKey = process.env.TAGES_SERVICE_KEY
    delete process.env.TAGES_SERVICE_KEY
    origCwd = process.cwd()
    // realpath: on macOS os.tmpdir() is a /var -> /private/var symlink and
    // process.cwd() reports the resolved path.
    workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tages-badmcp-')))
    process.chdir(workDir)
    fs.writeFileSync(path.join(workDir, '.mcp.json'), GARBAGE)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.chdir(origCwd)
    console_.restore()
    cleanupConfigDir()
    fs.rmSync(workDir, { recursive: true, force: true })
    if (origServiceKey === undefined) delete process.env.TAGES_SERVICE_KEY
    else process.env.TAGES_SERVICE_KEY = origServiceKey
  })

  function assertNothingWritten() {
    expect(fs.readFileSync(path.join(workDir, '.mcp.json'), 'utf-8')).toBe(GARBAGE)
    expect(fs.existsSync(path.join(workDir, '.tages', 'config.json'))).toBe(false)
    const projectsDir = path.join(tempConfigDir, 'projects')
    const configs = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []
    expect(configs).toEqual([])
    expect(mocks.installPostCommitHook).not.toHaveBeenCalled()
  }

  function assertClearMessage(command: string) {
    const err = console_.errors.join('\n')
    expect(err).toContain(`Could not parse ${path.join(workDir, '.mcp.json')}`)
    expect(err).toContain(`tages ${command}`)
    expect(err).not.toMatch(/\n\s+at /) // no stack trace
  }

  it('link --project-id exits 1, names the file, and writes nothing', async () => {
    writeAuthConfig(tempConfigDir)
    mocks.findMemberProjectById.mockResolvedValue({ projectId: 'proj-1', slug: 'team-project' })

    await expect(linkCommand(undefined, { projectId: 'proj-1' })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    assertClearMessage('link')
    assertNothingWritten()
    // Fails before auth or network.
    expect(mocks.createAuthenticatedClient).not.toHaveBeenCalled()
    expect(mocks.runGithubOAuth).not.toHaveBeenCalled()
  })

  it('init (cloud) exits 1, names the file, and creates no project', async () => {
    await expect(initCommand({ slug: 'my-proj' })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    assertClearMessage('init')
    assertNothingWritten()
    expect(mocks.createCloudProject).not.toHaveBeenCalled()
    expect(mocks.runGithubOAuth).not.toHaveBeenCalled()
  })

  it('init --local exits 1 and writes no project config', async () => {
    await expect(initCommand({ local: true, slug: 'my-proj' })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    assertClearMessage('init')
    assertNothingWritten()
  })

  it('a top-level JSON array is rejected too', () => {
    fs.writeFileSync(path.join(workDir, '.mcp.json'), '[]')
    expect(() => assertMcpConfigParsable()).toThrow(McpConfigParseError)
  })

  it('a missing .mcp.json is fine', () => {
    fs.rmSync(path.join(workDir, '.mcp.json'))
    expect(() => assertMcpConfigParsable()).not.toThrow()
  })
})
