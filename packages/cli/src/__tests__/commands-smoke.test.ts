import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  writeAuthConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
  TEST_AUTH,
} from './helpers.js'

// --- Global mocks ---

// Mock ora (used by many commands)
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

// Mock open (used by dashboard)
vi.mock('open', () => ({ default: vi.fn() }))

// Mock github-oauth
vi.mock('../auth/github-oauth.js', () => ({
  runGithubOAuth: vi.fn().mockResolvedValue({
    accessToken: 'mock-access',
    refreshToken: 'mock-refresh',
    userId: 'mock-user-id',
  }),
}))

// Mock MCP inject
vi.mock('../config/mcp-inject.js', () => ({
  injectMcpConfig: vi.fn().mockReturnValue({ path: '/mock/path', created: true }),
  readMcpConfig: vi.fn().mockReturnValue(null),
}))

// Mock token-auth
vi.mock('../auth/token-auth.js', () => ({
  generateToken: vi.fn().mockReturnValue({
    token: 'tages_mock_token_abc123',
    hash: 'mock_hash_sha256',
  }),
}))

// Mock child_process (used by check, snapshot)
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}))

// Build a flexible mock Supabase
/**
 * Creates a thenable chain that resolves using the CURRENT values of mockData/mockError
 * at the time `.then()` is called (not at chain creation time).
 */
function makeMockChain(data?: unknown[] | null, error?: { message: string } | null) {
  const resolveData = () => data !== undefined ? data : mockData
  const resolveError = () => error !== undefined ? error : mockError

  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(() => Promise.resolve({ data: resolveData()?.[0] ?? null, error: resolveError() })),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: resolveError() })),
    insert: vi.fn(() => Promise.resolve({ data: null, error: resolveError() })),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn(() => Promise.resolve({ data: null, error: resolveError() })),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn(() => Promise.resolve({ data: null, error: resolveError() })),
    }),
  }
  // Make thenable -- resolves lazily
  Object.defineProperty(chain, 'then', {
    get() {
      return (resolve: (v: unknown) => void) =>
        Promise.resolve({ data: resolveData(), error: resolveError() }).then(resolve)
    },
    configurable: true,
  })
  return chain
}

let mockData: unknown[] | null = []
let mockError: { message: string } | null = null

// Mock the supabase.auth surface used by createAuthenticatedClient. Without
// these, code paths that read auth.json (any test using writeAuthConfig) crash
// with "cannot read 'setSession' of undefined" — surfaced by widening CI to
// pnpm -r test where TAGES_SERVICE_KEY isn't set, so the auth-path branch runs.
const mockAuth = {
  setSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'm' } }, error: null }),
  getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'm' } }, error: null }),
  refreshSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'm', refresh_token: 'm' } }, error: null }),
}

const mockSupabase = {
  from: vi.fn(() => makeMockChain(mockData, mockError)),
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  auth: mockAuth,
}

function resetMockSupabase() {
  mockData = []
  mockError = null
  mockSupabase.from = vi.fn(() => makeMockChain(mockData, mockError))
  mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null })
  mockAuth.setSession.mockClear()
  mockAuth.getSession.mockClear()
  mockAuth.refreshSession.mockClear()
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
  getProjectConfigPath: (slug: string) => path.join(tempConfigDir, 'projects', `${slug}.json`),
}))

// --- Import commands ---
import { dedupCommand } from '../commands/dedup.js'
import { impactCommand, riskCommand } from '../commands/impact.js'
import { enforceCommand, enforceCheckCommand } from '../commands/enforce.js'
import { qualityCommand } from '../commands/quality.js'
import { exportCommand } from '../commands/export.js'
import { pendingCommand } from '../commands/pending.js'
import { verifyCommand } from '../commands/verify.js'
import { suggestCommand } from '../commands/suggest.js'
import { onboardCommand } from '../commands/onboard.js'
import { tokenGenerateCommand, tokenListCommand, tokenRotateCommand } from '../commands/token.js'

describe('dedup command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(dedupCommand({})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('requires Supabase connection', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(dedupCommand({})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('Supabase')
    exitSpy.mockRestore()
  })

  it('reports no duplicates when memories are dissimilar', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'use-typescript', value: 'Always use TypeScript strict mode', type: 'convention', status: 'live' },
      { key: 'db-design', value: 'Use PostgreSQL with normalized tables', type: 'architecture', status: 'live' },
    ]

    await dedupCommand({})

    expect(console_.logs.join('\n')).toContain('No duplicate')
  })

  it('detects duplicate memories with high similarity', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'use-strict', value: 'Always use TypeScript strict mode in all files', type: 'convention', status: 'live' },
      { key: 'typescript-strict', value: 'Use TypeScript strict mode always in every file', type: 'convention', status: 'live' },
    ]

    await dedupCommand({ threshold: '0.5' })

    expect(console_.logs.join('\n')).toContain('potential duplicate')
  })
})

describe('impact command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(impactCommand('key', {})).rejects.toThrow('exit')
    exitSpy.mockRestore()
  })

  it('shows impact analysis for a key with no dependents', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'target', cross_system_refs: null, confidence: 1.0, updated_at: new Date().toISOString() },
    ]

    await impactCommand('target', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('Impact analysis')
    expect(output).toContain('Direct dependents:  0')
  })

  it('shows dependents when cross_system_refs reference the key', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'base-pattern', cross_system_refs: null, confidence: 1.0, updated_at: new Date().toISOString() },
      { key: 'derived-pattern', cross_system_refs: '["base-pattern"]', confidence: 0.8, updated_at: new Date().toISOString() },
    ]

    await impactCommand('base-pattern', {})

    const output = console_.logs.join('\n')
    expect(output).toContain('Direct dependents:  1')
    expect(output).toContain('derived-pattern')
  })
})

describe('risk command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('shows top riskiest memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days ago
    mockData = [
      { key: 'risky', cross_system_refs: null, confidence: 0.3, updated_at: oldDate },
      { key: 'safe', cross_system_refs: null, confidence: 1.0, updated_at: new Date().toISOString() },
    ]

    await riskCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Riskiest')
  })
})

describe('enforce command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('prints enforcement report header', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await enforceCommand({})

    expect(console_.logs.join('\n')).toContain('Convention Enforcement')
  })

  it('enforce check reports COMPLIANT when no conflicts', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    // First call: memory being checked; second call: conventions list
    let callIdx = 0
    mockSupabase.from.mockImplementation(() => {
      callIdx++
      if (callIdx === 1) {
        // Memory being checked (single)
        return makeMockChain([{ id: '1', key: 'test-mem', value: 'Use hooks for state', type: 'convention' }])
      }
      // Convention list
      return makeMockChain([
        { id: '2', key: 'react-hooks', value: 'Always use hooks for component state', type: 'convention' },
      ])
    })

    await enforceCheckCommand('test-mem', {})

    expect(console_.logs.join('\n')).toContain('COMPLIANT')
  })
})

describe('quality command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('shows project health score with live memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'k1', value: 'A good convention with enough detail', type: 'convention', confidence: 0.9, updatedAt: new Date().toISOString(), tags: ['tag1'], filePaths: ['f.ts'], conditions: [], examples: [], crossSystemRefs: [] },
      { key: 'k2', value: 'Another convention', type: 'convention', confidence: 0.7, updatedAt: new Date().toISOString(), tags: [], filePaths: [], conditions: [], examples: [], crossSystemRefs: [] },
    ]

    await qualityCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Health Score')
    expect(output).toContain('2 live memories')
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(qualityCommand({})).rejects.toThrow('exit')
    exitSpy.mockRestore()
  })
})

describe('export command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('exports memories as claude-md format', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'strict-mode', value: 'Use strict mode', type: 'convention', file_paths: ['tsconfig.json'] },
      { key: 'module-boundary', value: 'Keep modules small', type: 'architecture', file_paths: [] },
    ]

    const outputPath = path.join(tempConfigDir, 'CLAUDE.md')
    await exportCommand({ output: outputPath })

    expect(fs.existsSync(outputPath)).toBe(true)
    const content = fs.readFileSync(outputPath, 'utf-8')
    expect(content).toContain('strict-mode')
    expect(content).toContain('Conventions')
    expect(content).toContain('Architecture')
  })

  it('exports as JSON format', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'k1', value: 'v1', type: 'convention' },
    ]

    const outputPath = path.join(tempConfigDir, 'export.json')
    await exportCommand({ output: outputPath, format: 'json' })

    const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
    expect(content).toHaveLength(1)
    expect(content[0].key).toBe('k1')
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(exportCommand({})).rejects.toThrow('exit')
    exitSpy.mockRestore()
  })
})

describe('pending command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('shows pending memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { id: '1', key: 'pending-1', type: 'convention', confidence: 0.8, created_at: new Date().toISOString() },
    ]

    await pendingCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('1 pending memory')
    expect(output).toContain('pending-1')
  })

  it('shows message when no pending memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = []

    await pendingCommand({})

    expect(console_.logs.join('\n')).toContain('No memories pending')
  })
})

describe('verify command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(verifyCommand('key', {})).rejects.toThrow('exit')
    exitSpy.mockRestore()
  })

  it('requires Supabase connection', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(verifyCommand('key', {})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('cloud connection')
    exitSpy.mockRestore()
  })
})

describe('suggest command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('suggests missing memory types', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { type: 'convention' },
      { type: 'convention' },
    ]

    await suggestCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('Suggestions')
    // Should suggest types that are missing (decision, architecture, entity, etc.)
    expect(output).toContain('decision')
  })

  it('shows good coverage message when all types present', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { type: 'convention' }, { type: 'convention' }, { type: 'convention' },
      { type: 'decision' }, { type: 'decision' }, { type: 'decision' },
      { type: 'architecture' }, { type: 'architecture' }, { type: 'architecture' },
      { type: 'entity' }, { type: 'entity' }, { type: 'entity' },
      { type: 'lesson' }, { type: 'lesson' }, { type: 'lesson' },
      { type: 'pattern' }, { type: 'pattern' }, { type: 'pattern' },
      { type: 'execution' }, { type: 'execution' }, { type: 'execution' },
    ]

    await suggestCommand({})

    expect(console_.logs.join('\n')).toContain('Good coverage')
  })
})

describe('onboard command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('displays a project briefing with grouped memories', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { key: 'api-design', value: 'REST with OpenAPI specs', type: 'architecture', file_paths: ['api/'], confidence: 0.95 },
      { key: 'naming', value: 'Use camelCase for variables', type: 'convention', confidence: 1.0 },
    ]

    await onboardCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('PROJECT BRIEFING')
    expect(output).toContain('api-design')
    expect(output).toContain('naming')
  })

  it('exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(onboardCommand({})).rejects.toThrow('exit')
    exitSpy.mockRestore()
  })
})

describe('token commands', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    resetMockSupabase()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('token generate exits when no project configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(tokenGenerateCommand({})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('token generate exits when not authenticated', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(tokenGenerateCommand({})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('Not authenticated')
    exitSpy.mockRestore()
  })

  it('token generate creates a token when authenticated', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    writeAuthConfig(tempConfigDir)

    await tokenGenerateCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('API token created')
    expect(output).toContain('tages_mock_token_abc123')
  })

  it('token list shows tokens', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = [
      { id: '1', name: 'default', created_at: '2025-01-01T00:00:00Z', last_used: null },
    ]

    await tokenListCommand({})

    expect(console_.logs.join('\n')).toContain('default')
  })

  it('token list shows empty message when no tokens', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockData = []

    await tokenListCommand({})

    expect(console_.logs.join('\n')).toContain('No API tokens')
  })

  it('token rotate exits when not authenticated', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    await expect(tokenRotateCommand({})).rejects.toThrow('exit')
    expect(console_.errors.join('\n')).toContain('Not authenticated')
    exitSpy.mockRestore()
  })
})
