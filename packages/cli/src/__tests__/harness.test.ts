import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { captureConsole } from './helpers.js'

vi.mock('../config/project.js', () => ({
  loadProjectConfig: vi.fn(),
}))

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: vi.fn(),
}))

// Mock readline so tests never hang on an interactive prompt.
const { mockQuestion } = vi.hoisted(() => ({
  mockQuestion: vi.fn((_msg: string, cb: (answer: string) => void) => cb('y')),
}))
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: vi.fn(),
  })),
}))

// Mock ora so spinner output doesn't pollute captured console output.
vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }
  return { default: vi.fn(() => spinner) }
})

const TEST_CLOUD_CONFIG = {
  projectId: 'test-project-id',
  slug: 'test-project',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}

import {
  mergeHarnessHooks,
  removeHarnessHooks,
  isHarnessEnabled,
  harnessEnableCommand,
  harnessDisableCommand,
  harnessSyncCommand,
} from '../commands/harness.js'
import { loadProjectConfig } from '../config/project.js'
import { createAuthenticatedClient } from '../auth/session.js'
import { HarnessLog, getHarnessDbPath } from '../../../harness-claude-code/src/local-log.js'

const TAGES_HOOK_COMMAND = 'tages-harness-claude-code'

// A pre-populated fixture representing a developer's settings.local.json
// that already has unrelated hooks (a different plugin) and unrelated
// top-level keys (permissions) before they ever run `tages harness enable`.
// The merge-not-overwrite behavior against exactly this kind of file is
// called out in the plan as the single highest-risk behavior in this task.
const PRE_POPULATED_SETTINGS = {
  permissions: {
    allow: ['Bash(npm run *)'],
  },
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'some-other-plugin-hook' }],
      },
    ],
    Notification: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: 'notify-hook' }],
      },
    ],
  },
  someOtherTopLevelKey: 'unrelated-value',
}

describe('mergeHarnessHooks / removeHarnessHooks / isHarnessEnabled (pure logic)', () => {
  it('adds a Tages-owned group to all four harness hook events on an empty settings object', () => {
    const merged = mergeHarnessHooks({})
    expect(isHarnessEnabled(merged)).toBe(true)
    for (const event of ['PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop']) {
      const groups = merged.hooks![event]
      expect(groups).toHaveLength(1)
      expect(groups![0].hooks[0].command).toBe(TAGES_HOOK_COMMAND)
    }
  })

  it('preserves pre-existing unrelated hooks entries and top-level keys untouched', () => {
    const merged = mergeHarnessHooks(PRE_POPULATED_SETTINGS)

    // Unrelated top-level key untouched
    expect(merged.someOtherTopLevelKey).toBe('unrelated-value')
    // Unrelated permissions block untouched
    expect(merged.permissions).toEqual(PRE_POPULATED_SETTINGS.permissions)
    // Unrelated PreToolUse group (different command) still present alongside the new Tages group
    expect(merged.hooks!.PreToolUse).toHaveLength(2)
    expect(merged.hooks!.PreToolUse!.some((g) => g.hooks[0].command === 'some-other-plugin-hook')).toBe(true)
    expect(merged.hooks!.PreToolUse!.some((g) => g.hooks[0].command === TAGES_HOOK_COMMAND)).toBe(true)
    // Unrelated event (Notification) that Tages never touches is untouched
    expect(merged.hooks!.Notification).toEqual(PRE_POPULATED_SETTINGS.hooks.Notification)
    // All four harness events now enabled
    expect(isHarnessEnabled(merged)).toBe(true)
  })

  it('is idempotent — re-merging does not duplicate the Tages group', () => {
    const once = mergeHarnessHooks(PRE_POPULATED_SETTINGS)
    const twice = mergeHarnessHooks(once)
    expect(twice.hooks!.PreToolUse).toHaveLength(2)
    expect(twice.hooks!.PreToolUse!.filter((g) => g.hooks[0].command === TAGES_HOOK_COMMAND)).toHaveLength(1)
  })

  it('removeHarnessHooks strips only the Tages block, leaving unrelated hooks/keys intact', () => {
    const merged = mergeHarnessHooks(PRE_POPULATED_SETTINGS)
    const removed = removeHarnessHooks(merged)

    expect(isHarnessEnabled(removed)).toBe(false)
    // Unrelated content survives
    expect(removed.someOtherTopLevelKey).toBe('unrelated-value')
    expect(removed.permissions).toEqual(PRE_POPULATED_SETTINGS.permissions)
    expect(removed.hooks!.PreToolUse).toHaveLength(1)
    expect(removed.hooks!.PreToolUse![0].hooks[0].command).toBe('some-other-plugin-hook')
    expect(removed.hooks!.Notification).toEqual(PRE_POPULATED_SETTINGS.hooks.Notification)
    // Events that were Tages-only (PostToolUse/SessionEnd/Stop) are removed entirely
    expect(removed.hooks!.PostToolUse).toBeUndefined()
    expect(removed.hooks!.SessionEnd).toBeUndefined()
    expect(removed.hooks!.Stop).toBeUndefined()
  })

  it('removeHarnessHooks on settings with no hooks block is a no-op', () => {
    const settings = { permissions: { allow: [] } }
    expect(removeHarnessHooks(settings)).toEqual(settings)
  })
})

describe('harness enable/disable — filesystem integration against .claude/settings.local.json', () => {
  let tmpProjectDir: string
  let origCwd: string
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    origCwd = process.cwd()
    tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-harness-test-'))
    process.chdir(tmpProjectDir)
    console_ = captureConsole()
    vi.mocked(loadProjectConfig).mockReturnValue(TEST_CLOUD_CONFIG)
    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => cb('y'))
  })

  afterEach(() => {
    console_.restore()
    process.chdir(origCwd)
    fs.rmSync(tmpProjectDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  function settingsPath(): string {
    return path.join(tmpProjectDir, '.claude', 'settings.local.json')
  }

  it('enable writes the hooks block to .claude/settings.local.json', async () => {
    await harnessEnableCommand({ project: 'test-project', yes: true })

    expect(fs.existsSync(settingsPath())).toBe(true)
    const written = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
    expect(isHarnessEnabled(written)).toBe(true)
  })

  it('enable MERGES into a pre-populated settings.local.json fixture, preserving unrelated content untouched', async () => {
    // Write the fixture BEFORE running enable — this is the highest-risk
    // behavior per the plan's pre-mortem: a real developer's file with
    // other hooks/permissions already in it must not be clobbered.
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(PRE_POPULATED_SETTINGS, null, 2))

    await harnessEnableCommand({ project: 'test-project', yes: true })

    const written = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
    expect(written.someOtherTopLevelKey).toBe('unrelated-value')
    expect(written.permissions).toEqual(PRE_POPULATED_SETTINGS.permissions)
    expect(written.hooks.Notification).toEqual(PRE_POPULATED_SETTINGS.hooks.Notification)
    expect(written.hooks.PreToolUse).toHaveLength(2)
    expect(written.hooks.PreToolUse.some((g: { hooks: { command: string }[] }) => g.hooks[0].command === 'some-other-plugin-hook')).toBe(true)
    expect(isHarnessEnabled(written)).toBe(true)
  })

  it('enable refuses when no cloud project config exists', async () => {
    vi.mocked(loadProjectConfig).mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(harnessEnableCommand({ yes: true })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(fs.existsSync(settingsPath())).toBe(false)
    exitSpy.mockRestore()
  })

  it('enable does nothing (no write) when the user declines confirmation', async () => {
    mockQuestion.mockImplementation((_msg: string, cb: (answer: string) => void) => cb('n'))

    await harnessEnableCommand({ project: 'test-project' })

    expect(fs.existsSync(settingsPath())).toBe(false)
  })

  it('disable removes only the Tages block from a fixture with mixed content', async () => {
    // First enable against the pre-populated fixture, then disable, and
    // assert we're back to the pre-populated content plus nothing extra.
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(PRE_POPULATED_SETTINGS, null, 2))
    await harnessEnableCommand({ project: 'test-project', yes: true })

    await harnessDisableCommand({})

    const written = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
    expect(isHarnessEnabled(written)).toBe(false)
    expect(written.someOtherTopLevelKey).toBe('unrelated-value')
    expect(written.permissions).toEqual(PRE_POPULATED_SETTINGS.permissions)
    expect(written.hooks.PreToolUse).toHaveLength(1)
    expect(written.hooks.PreToolUse[0].hooks[0].command).toBe('some-other-plugin-hook')
    expect(written.hooks.Notification).toEqual(PRE_POPULATED_SETTINGS.hooks.Notification)
  })

  it('disable on an already-disabled project reports nothing to do without writing a file', async () => {
    await harnessDisableCommand({})
    expect(fs.existsSync(settingsPath())).toBe(false)
  })
})

describe('harness sync — batches unsynced local rows into ONE Supabase insert call', () => {
  let tmpHome: string
  let origHome: string | undefined
  let console_: ReturnType<typeof captureConsole>
  let insertMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    origHome = process.env.HOME
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-harness-home-'))
    process.env.HOME = tmpHome
    console_ = captureConsole()

    vi.mocked(loadProjectConfig).mockReturnValue(TEST_CLOUD_CONFIG)

    insertMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    }
    vi.mocked(createAuthenticatedClient).mockResolvedValue(mockSupabase as never)
  })

  afterEach(() => {
    console_.restore()
    process.env.HOME = origHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  function seedLocalLog(n: number): void {
    const dbPath = getHarnessDbPath(process.cwd())
    const log = new HarnessLog(dbPath)
    for (let i = 0; i < n; i++) {
      log.append({
        source: 'claude_code_hook',
        sessionId: `sess-${i}`,
        eventType: 'pre_tool_use',
        agentName: 'test-agent',
        toolName: 'Read',
        exitCode: null,
        filePath: `/tmp/file-${i}.ts`,
        durationMs: null,
        argsScrubbed: { path: `/tmp/file-${i}.ts` },
        resultSummary: null,
        secretsRedactedCount: 0,
        createdAt: new Date().toISOString(),
      })
    }
    log.close()
  }

  it('sends exactly one batched .insert() call carrying all pending rows, not N calls', async () => {
    seedLocalLog(5)

    await harnessSyncCommand({ project: 'test-project' })

    expect(insertMock).toHaveBeenCalledTimes(1)
    const payload = insertMock.mock.calls[0][0]
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(5)
  })

  it('marks synced rows so a second sync call has nothing pending', async () => {
    seedLocalLog(3)

    await harnessSyncCommand({ project: 'test-project' })
    expect(insertMock).toHaveBeenCalledTimes(1)

    insertMock.mockClear()
    await harnessSyncCommand({ project: 'test-project' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('does nothing when there are no local events to sync', async () => {
    await harnessSyncCommand({ project: 'test-project' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('refuses when no cloud project config exists', async () => {
    vi.mocked(loadProjectConfig).mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(harnessSyncCommand({})).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
