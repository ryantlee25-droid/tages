import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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
    // We need to mock getClaudeDesktopConfigPath to point at our temp dir
    vi.doMock('../config/paths.js', () => ({
      getClaudeDesktopConfigPath: () => path.join(tempDir, 'claude_config.json'),
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
    const configPath = path.join(tempDir, 'claude_config.json')
    expect(fs.existsSync(configPath)).toBe(true)

    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(content.mcpServers.tages).toBeDefined()
    expect(content.mcpServers.tages.command).toBe('npx')
    expect(content.mcpServers.tages.env.TAGES_SUPABASE_URL).toBe('https://test.supabase.co')

    vi.doUnmock('../config/paths.js')
  })

  it('injectMcpConfig preserves existing MCP entries', async () => {
    const configPath = path.join(tempDir, 'claude_config.json')
    // Write a pre-existing config
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        'other-server': { command: 'node', args: ['server.js'] },
      },
    }))

    vi.doMock('../config/paths.js', () => ({
      getClaudeDesktopConfigPath: () => configPath,
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
