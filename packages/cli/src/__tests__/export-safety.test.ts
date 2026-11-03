import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { captureConsole, TEST_PROJECT_CONFIG } from './helpers.js'

// Fake PostgREST builder that honours `.eq()` filters, so dropping the
// status filter from export.ts makes the pending/archived tests fail.
const rows = [
  { key: 'conv-a', value: 'LIVE_CONVENTION_VALUE', type: 'convention', status: 'live', project_id: 'test-project-id' },
  { key: 'arch-a', value: 'LIVE_ARCH_VALUE', type: 'architecture', status: 'live', project_id: 'test-project-id' },
  { key: 'dec-a', value: 'LIVE_DECISION_VALUE', type: 'decision', status: 'live', project_id: 'test-project-id' },
  { key: 'pat-a', value: 'LIVE_PATTERN_VALUE', type: 'pattern', status: 'live', project_id: 'test-project-id' },
  { key: 'les-a', value: 'LIVE_LESSON_VALUE', type: 'lesson', status: 'live', project_id: 'test-project-id' },
  { key: 'ent-a', value: 'LIVE_ENTITY_VALUE', type: 'entity', status: 'live', project_id: 'test-project-id' },
  { key: 'dont-a', value: 'Never commit LIVE_ANTI_PATTERN_VALUE', type: 'anti_pattern', status: 'live', project_id: 'test-project-id' },
  { key: 'pref-a', value: 'LIVE_PREFERENCE_VALUE', type: 'preference', status: 'live', project_id: 'test-project-id' },
  { key: 'exec-a', value: 'LIVE_EXECUTION_VALUE', type: 'execution', status: 'live', project_id: 'test-project-id' },
  { key: 'ops-a', value: 'LIVE_OPERATIONAL_VALUE', type: 'operational', status: 'live', project_id: 'test-project-id' },
  { key: 'env-a', value: 'LIVE_ENVIRONMENT_VALUE', type: 'environment', status: 'live', project_id: 'test-project-id' },
  { key: 'pend-a', value: 'PENDING_LEAK_VALUE', type: 'convention', status: 'pending', project_id: 'test-project-id' },
  { key: 'arch-old', value: 'ARCHIVED_LEAK_VALUE', type: 'decision', status: 'archived', project_id: 'test-project-id' },
]

function fakeSupabase() {
  return {
    from: vi.fn(() => {
      const filters: Array<[string, unknown]> = []
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return builder },
        order: () => builder,
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({
            data: rows.filter(r => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)),
            error: null,
          }).then(resolve),
      }
      return builder
    }),
  }
}

const mocks = vi.hoisted(() => ({ createAuthenticatedClient: vi.fn() }))

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mocks.createAuthenticatedClient,
}))

vi.mock('../config/project.js', () => ({
  loadProjectConfig: () => TEST_PROJECT_CONFIG,
}))

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }
  return { default: vi.fn(() => spinner) }
})

import { exportCommand } from '../commands/export.js'

const HAND_WRITTEN = '# Hand-written CLAUDE.md\n\nHAND_SENTINEL: a human wrote this.\n'

describe('tages export: safety and content', () => {
  let console_: ReturnType<typeof captureConsole>
  let workDir: string
  let origCwd: string
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    console_ = captureConsole()
    vi.clearAllMocks()
    mocks.createAuthenticatedClient.mockImplementation(async () => fakeSupabase())
    origCwd = process.cwd()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-export-'))
    process.chdir(workDir)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    process.chdir(origCwd)
    console_.restore()
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('refuses to overwrite an existing CLAUDE.md: exit 1, file byte-identical, message names --output and --force', async () => {
    const target = path.join(workDir, 'CLAUDE.md')
    fs.writeFileSync(target, HAND_WRITTEN)

    await expect(exportCommand({})).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(fs.readFileSync(target, 'utf-8')).toBe(HAND_WRITTEN)
    const err = console_.errors.join('\n')
    expect(err).toContain('already exists')
    expect(err).toContain('--output')
    expect(err).toContain('--force')
    // Refusal happens before any network call.
    expect(mocks.createAuthenticatedClient).not.toHaveBeenCalled()
  })

  it('overwrites an existing CLAUDE.md with --force', async () => {
    const target = path.join(workDir, 'CLAUDE.md')
    fs.writeFileSync(target, HAND_WRITTEN)

    await exportCommand({ force: true })

    const out = fs.readFileSync(target, 'utf-8')
    expect(out).not.toContain('HAND_SENTINEL')
    expect(out).toContain('LIVE_CONVENTION_VALUE')
  })

  it('writes CLAUDE.md when none exists', async () => {
    await exportCommand({})
    expect(fs.readFileSync(path.join(workDir, 'CLAUDE.md'), 'utf-8')).toContain('LIVE_CONVENTION_VALUE')
  })

  it('--output to a new path works and leaves the existing CLAUDE.md alone', async () => {
    const target = path.join(workDir, 'CLAUDE.md')
    fs.writeFileSync(target, HAND_WRITTEN)
    const outFile = path.join(workDir, 'export-A.md')

    await exportCommand({ output: outFile })

    expect(fs.readFileSync(outFile, 'utf-8')).toContain('LIVE_CONVENTION_VALUE')
    expect(fs.readFileSync(target, 'utf-8')).toBe(HAND_WRITTEN)
  })

  it('--output to an existing path refuses without --force', async () => {
    const outFile = path.join(workDir, 'existing.md')
    fs.writeFileSync(outFile, 'KEEP_ME')

    await expect(exportCommand({ output: outFile })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(fs.readFileSync(outFile, 'utf-8')).toBe('KEEP_ME')
  })

  it('excludes pending and archived memories', async () => {
    const outFile = path.join(workDir, 'out.md')
    await exportCommand({ output: outFile })
    const out = fs.readFileSync(outFile, 'utf-8')
    expect(out).not.toContain('PENDING_LEAK_VALUE')
    expect(out).not.toContain('ARCHIVED_LEAK_VALUE')
  })

  it('excludes pending and archived from the json format too', async () => {
    const outFile = path.join(workDir, 'out.json')
    await exportCommand({ output: outFile, format: 'json' })
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as Array<{ status: string }>
    expect(parsed.every(m => m.status === 'live')).toBe(true)
  })

  it('emits every live type, including anti_pattern under a heading import classifies as anti_pattern', async () => {
    const outFile = path.join(workDir, 'out.md')
    await exportCommand({ output: outFile })
    const out = fs.readFileSync(outFile, 'utf-8')
    for (const r of rows.filter(r => r.status === 'live')) {
      expect(out, `missing ${r.type}`).toContain(r.value)
    }
    expect(out).toMatch(/^## Anti-patterns \(Don't \/ Never\)$/m)
    expect(out).toContain('- Never commit LIVE_ANTI_PATTERN_VALUE')
  })
})
