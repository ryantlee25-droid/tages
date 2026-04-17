import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { Memory } from '@tages/shared'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

const {
  mockGetByKey,
  mockGetByType,
  mockUpsertMemory,
  mockFlush,
  mockClose,
  mockOpenCliSync,
} = vi.hoisted(() => {
  const mockGetByKey = vi.fn()
  const mockGetByType = vi.fn()
  const mockUpsertMemory = vi.fn()
  const mockFlush = vi.fn().mockResolvedValue(undefined)
  const mockClose = vi.fn()
  const mockOpenCliSync = vi.fn().mockResolvedValue({
    cache: {
      getByKey: mockGetByKey,
      getByType: mockGetByType,
      upsertMemory: mockUpsertMemory,
    },
    flush: mockFlush,
    close: mockClose,
  })
  return {
    mockGetByKey,
    mockGetByType,
    mockUpsertMemory,
    mockFlush,
    mockClose,
    mockOpenCliSync,
  }
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

import {
  capture_session_context,
  rehydrate_session_context,
  sessionSaveCommand,
  sessionLoadCommand,
} from '../commands/session.js'

describe('session command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    mockFlush.mockResolvedValue(undefined)
    mockOpenCliSync.mockResolvedValue({
      cache: {
        getByKey: mockGetByKey,
        getByType: mockGetByType,
        upsertMemory: mockUpsertMemory,
      },
      flush: mockFlush,
      close: mockClose,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('capture_session_context extracts high-signal fields from tagged input', () => {
    const context = capture_session_context({
      input: [
        'goal: Continue Veil of the Towers',
        'constraints: Keep established canon and NPC names',
        'decisions: The rune key is with Sister Merel',
        'questions: Where was the last rune fragment found',
        'issues: Missing Session 12 map details',
        'tags: provider:chatgpt, veil-of-the-towers',
        'We are currently blocked until we recover the rune key from the tower archives.',
      ].join('\n'),
    })

    expect(context.current_objective).toContain('Veil of the Towers')
    expect(context.active_constraints[0]).toContain('canon')
    expect(context.recent_decisions[0]).toContain('rune key')
    expect(context.open_questions[0]).toContain('rune fragment')
    expect(context.known_issues[0]).toContain('Session 12')
    expect(context.optional_tags).toContain('provider:chatgpt')
    expect(context.working_summary.length).toBeGreaterThan(0)
  })

  it('rehydrate_session_context returns prompt-ready output', () => {
    const rendered = rehydrate_session_context({
      current_objective: 'Continue campaign planning',
      active_constraints: ['Do not retcon established outcomes'],
      recent_decisions: ['Tower entrance requires the obsidian sigil'],
      open_questions: ['Where did the sigil go after session 11?'],
      known_issues: ['Unsure where sigil was last seen'],
      working_summary: 'Current state is blocked on sigil location before next encounter.',
      optional_tags: ['provider:chatgpt'],
    })

    expect(rendered).toContain('SESSION HANDOFF (SHORT-LIVED)')
    expect(rendered).toContain('Current objective: Continue campaign planning')
    expect(rendered).toContain('Do not retcon established outcomes')
    expect(rendered).toContain('Open questions:')
    expect(rendered).toContain('Instruction: Continue from this handoff')
  })

  it('session save stores temporary session_context memory', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)
    mockGetByKey.mockReturnValue(null)

    await sessionSaveCommand('goal: Continue Veil of the Towers', {
      tags: ['provider:chatgpt', 'veil-of-the-towers'],
    })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'session-handoff-active',
        type: 'session_context',
        source: 'manual',
        status: 'live',
      }),
      true,
    )

    const saved = mockUpsertMemory.mock.calls[0]?.[0] as Memory
    expect(saved.tags).toContain('provider:chatgpt')
    expect(saved.tags).toContain('session_handoff')
    expect(saved.tags).toContain('session_context')
    expect(mockFlush).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('session load returns latest saved session context', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)
    mockGetByKey.mockReturnValue(null)

    const older: Memory = {
      id: '1',
      projectId: TEST_LOCAL_CONFIG.projectId,
      key: 'session-context-old',
      value: JSON.stringify({
        current_objective: 'Old objective',
        active_constraints: [],
        recent_decisions: [],
        open_questions: [],
        known_issues: [],
        working_summary: 'Old summary',
      }),
      type: 'session_context',
      source: 'manual',
      status: 'live',
      confidence: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const newer: Memory = {
      id: '2',
      projectId: TEST_LOCAL_CONFIG.projectId,
      key: 'session-context-new',
      value: JSON.stringify({
        current_objective: 'Continue Veil of the Towers',
        active_constraints: ['Keep canon'],
        recent_decisions: ['The sigil is in the archives'],
        open_questions: ['Who moved the sigil?'],
        known_issues: ['Need map details'],
        working_summary: 'Blocked on archive access.',
      }),
      type: 'session_context',
      source: 'manual',
      status: 'live',
      confidence: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }

    mockGetByType.mockReturnValue([older, newer])

    await sessionLoadCommand({})

    const output = console_.logs.join('\n')
    expect(output).toContain('SESSION HANDOFF (SHORT-LIVED)')
    expect(output).toContain('Continue Veil of the Towers')
    expect(output).toContain('Blocked on archive access.')
  })

  it('session load writes prompt block to output file when requested', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)
    const outputPath = path.join(tempConfigDir, 'out', 'session-prompt.txt')
    mockGetByKey.mockReturnValue(null)

    mockGetByType.mockReturnValue([
      {
        id: '1',
        projectId: TEST_LOCAL_CONFIG.projectId,
        key: 'session-context-active',
        value: JSON.stringify({
          current_objective: 'Continue campaign',
          active_constraints: [],
          recent_decisions: [],
          open_questions: [],
          known_issues: [],
          working_summary: 'Ready for next scene.',
        }),
        type: 'session_context',
        source: 'manual',
        status: 'live',
        confidence: 1,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      } satisfies Memory,
    ])

    await sessionLoadCommand({ output: outputPath })

    expect(fs.existsSync(outputPath)).toBe(true)
    const content = fs.readFileSync(outputPath, 'utf-8')
    expect(content).toContain('SESSION HANDOFF (SHORT-LIVED)')
    expect(content).toContain('Continue campaign')
  })
})
