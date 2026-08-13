import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'

describe('config/paths', () => {
  it('getConfigDir returns ~/.config/tages', async () => {
    const { getConfigDir } = await import('../config/paths.js')
    expect(getConfigDir()).toBe(path.join(os.homedir(), '.config', 'tages'))
  })

  it('getProjectsDir is inside config dir', async () => {
    const { getProjectsDir, getConfigDir } = await import('../config/paths.js')
    expect(getProjectsDir()).toBe(path.join(getConfigDir(), 'projects'))
  })

  it('getCachePath includes slug', async () => {
    const { getCachePath } = await import('../config/paths.js')
    const result = getCachePath('my-project')
    expect(result).toContain('my-project.db')
    expect(result).toContain('cache')
  })

  it('getProjectConfigPath includes slug', async () => {
    const { getProjectConfigPath } = await import('../config/paths.js')
    const result = getProjectConfigPath('test-slug')
    expect(result).toContain('test-slug.json')
    expect(result).toContain('projects')
  })

  it('getClaudeCodeMcpConfigPath is .mcp.json in the current working directory', async () => {
    const { getClaudeCodeMcpConfigPath } = await import('../config/paths.js')
    expect(getClaudeCodeMcpConfigPath()).toBe(path.join(process.cwd(), '.mcp.json'))
  })

  it('getClaudeDesktopConfigPath is a different, Desktop-only file', async () => {
    const { getClaudeCodeMcpConfigPath, getClaudeDesktopConfigPath } = await import('../config/paths.js')
    expect(getClaudeDesktopConfigPath()).toContain('claude_desktop_config.json')
    expect(getClaudeDesktopConfigPath()).not.toBe(getClaudeCodeMcpConfigPath())
  })
})

describe('config/mcp-inject', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-mcp-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('injectMcpConfig creates a new config file when none exists', async () => {
    // We need to mock getClaudeCodeMcpConfigPath to point at our temp dir
    vi.doMock('../config/paths.js', () => ({
      getClaudeCodeMcpConfigPath: () => path.join(tempDir, '.mcp.json'),
      getClaudeDesktopConfigPath: () => path.join(tempDir, 'claude_desktop_config.json'),
      getConfigDir: () => tempDir,
      getProjectsDir: () => path.join(tempDir, 'projects'),
      getAuthPath: () => path.join(tempDir, 'auth.json'),
    }))

    // Re-import to pick up the mock
    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    const result = injectMcpConfig({
      supabaseUrl: 'https://test.supabase.co',
      projectId: 'proj-1',
      projectSlug: 'test',
    })

    expect(result.created).toBe(true)
    const configPath = path.join(tempDir, '.mcp.json')
    expect(fs.existsSync(configPath)).toBe(true)

    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(content.mcpServers.tages).toBeDefined()
    expect(content.mcpServers.tages.command).toBe('npx')
    expect(content.mcpServers.tages.env.TAGES_SUPABASE_URL).toBe('https://test.supabase.co')

    vi.doUnmock('../config/paths.js')
  })

  it('injectMcpConfig preserves existing MCP entries', async () => {
    const configPath = path.join(tempDir, '.mcp.json')
    // Write a pre-existing config
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'other-server': { command: 'node', args: ['server.js'] },
      },
    }))

    vi.doMock('../config/paths.js', () => ({
      getClaudeCodeMcpConfigPath: () => configPath,
      getClaudeDesktopConfigPath: () => path.join(tempDir, 'claude_desktop_config.json'),
      getConfigDir: () => tempDir,
      getProjectsDir: () => path.join(tempDir, 'projects'),
      getAuthPath: () => path.join(tempDir, 'auth.json'),
    }))

    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    const result = injectMcpConfig({ projectSlug: 'test' })

    expect(result.created).toBe(false)
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    // Original entry preserved
    expect(content.mcpServers['other-server']).toBeDefined()
    // Tages entry added
    expect(content.mcpServers.tages).toBeDefined()

    vi.doUnmock('../config/paths.js')
  })
})

/**
 * These exercise the real `getClaudeCodeMcpConfigPath` (no paths.js mock) by
 * pointing `process.cwd()` at a temp directory, so they cover the actual
 * cwd -> .mcp.json resolution as well as the merge and git-exclude behavior.
 */
describe('config/mcp-inject — Claude Code project scope', () => {
  let tempDir: string
  let cwdSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('../config/paths.js')
    // realpath: macOS tmpdir is a symlink, and git reports resolved paths.
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cc-mcp-')))
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    logSpy.mockRestore()
    warnSpy.mockRestore()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const readWritten = () =>
    JSON.parse(fs.readFileSync(path.join(tempDir, '.mcp.json'), 'utf-8'))

  it('writes .mcp.json in the current working directory, not Claude Desktop config', async () => {
    const { injectMcpConfig } = await import('../config/mcp-inject.js')
    const { getClaudeDesktopConfigPath } = await import('../config/paths.js')

    const result = injectMcpConfig({ projectId: 'proj-1', projectSlug: 'test' })

    expect(result.path).toBe(path.join(tempDir, '.mcp.json'))
    expect(result.path).not.toBe(getClaudeDesktopConfigPath())
    expect(result.created).toBe(true)
    expect(fs.existsSync(path.join(tempDir, '.mcp.json'))).toBe(true)
  })

  it('honors serverCommand / serverArgs for a locally built server', async () => {
    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    injectMcpConfig({
      serverCommand: 'node',
      serverArgs: ['/abs/path/dist/index.js'],
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'anon-key',
      projectId: 'proj-1',
      projectSlug: 'test',
    })

    const content = readWritten()
    expect(content.mcpServers.tages.command).toBe('node')
    expect(content.mcpServers.tages.args).toEqual(['/abs/path/dist/index.js'])
    expect(content.mcpServers.tages.env).toEqual({
      TAGES_SUPABASE_URL: 'https://test.supabase.co',
      TAGES_SUPABASE_ANON_KEY: 'anon-key',
      TAGES_PROJECT_ID: 'proj-1',
      TAGES_PROJECT_SLUG: 'test',
    })
  })

  it('defaults to the npx form when serverCommand/serverArgs are absent', async () => {
    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    injectMcpConfig()

    const content = readWritten()
    expect(content.mcpServers.tages.command).toBe('npx')
    expect(content.mcpServers.tages.args).toEqual(['-y', '@tages/server'])
  })

  it('does not graft the npx args onto a custom serverCommand', async () => {
    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    injectMcpConfig({ serverCommand: '/opt/tages/server' })

    const content = readWritten()
    expect(content.mcpServers.tages.command).toBe('/opt/tages/server')
    expect(content.mcpServers.tages.args).toEqual([])
  })

  it("preserves a teammate's unrelated mcpServers entry and other top-level keys", async () => {
    fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp'], env: { HEADLESS: '1' } },
      },
      someOtherTopLevelKey: { keep: true },
    }, null, 2))

    const { injectMcpConfig } = await import('../config/mcp-inject.js')
    const result = injectMcpConfig({ projectSlug: 'test' })

    expect(result.created).toBe(false)
    const content = readWritten()
    expect(content.mcpServers.playwright).toEqual({
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
      env: { HEADLESS: '1' },
    })
    expect(content.someOtherTopLevelKey).toEqual({ keep: true })
    expect(content.mcpServers.tages).toBeDefined()
  })

  it('refuses to clobber an unparseable existing .mcp.json', async () => {
    const configPath = path.join(tempDir, '.mcp.json')
    fs.writeFileSync(configPath, '{ not json')

    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    expect(() => injectMcpConfig({ projectSlug: 'test' })).toThrow(/Could not parse existing MCP config/)
    expect(fs.readFileSync(configPath, 'utf-8')).toBe('{ not json')
  })

  it('adds .mcp.json to the repo local git excludes and reports it', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: tempDir, stdio: 'ignore' })

    const { injectMcpConfig } = await import('../config/mcp-inject.js')
    const result = injectMcpConfig({ projectId: 'proj-1', supabaseAnonKey: 'anon-key' })

    expect(result.excluded).toBe(true)
    const excludePath = path.join(tempDir, '.git', 'info', 'exclude')
    expect(result.excludePath).toBe(excludePath)
    expect(fs.readFileSync(excludePath, 'utf-8').split('\n')).toContain('.mcp.json')

    // git itself agrees the file is ignored
    const ignored = execFileSync('git', ['check-ignore', '.mcp.json'], {
      cwd: tempDir,
      encoding: 'utf-8',
    }).trim()
    expect(ignored).toBe('.mcp.json')

    expect(logSpy).toHaveBeenCalled()
  })

  it('does not duplicate the exclude entry on repeated init', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: tempDir, stdio: 'ignore' })

    const { injectMcpConfig } = await import('../config/mcp-inject.js')
    injectMcpConfig({ projectSlug: 'test' })
    injectMcpConfig({ projectSlug: 'test' })

    const lines = fs.readFileSync(path.join(tempDir, '.git', 'info', 'exclude'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim() === '.mcp.json')
    expect(lines).toHaveLength(1)
  })

  it('skips the exclude step silently outside a git repo', async () => {
    const { injectMcpConfig } = await import('../config/mcp-inject.js')

    const result = injectMcpConfig({ projectSlug: 'test' })

    expect(result.excluded).toBe(false)
    expect(result.excludePath).toBeUndefined()
    expect(fs.existsSync(path.join(tempDir, '.mcp.json'))).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
