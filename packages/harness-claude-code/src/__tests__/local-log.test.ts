import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HarnessEvent } from '@tages/shared'
import { HarnessLog, detectSlug, getHarnessDbPath } from '../local-log'

function makeEvent(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    source: 'claude_code_hook',
    sessionId: 'sess-1',
    eventType: 'pre_tool_use',
    agentName: null,
    toolName: 'Bash',
    exitCode: null,
    filePath: null,
    durationMs: null,
    argsScrubbed: { command: 'echo hi' },
    resultSummary: null,
    secretsRedactedCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('HarnessLog', () => {
  let tmpDir: string
  let dbPath: string
  let log: HarnessLog

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-log-test-'))
    dbPath = path.join(tmpDir, 'test-harness.db')
    log = new HarnessLog(dbPath)
  })

  afterEach(() => {
    log.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates the db file and schema on construction', () => {
    expect(fs.existsSync(dbPath)).toBe(true)
    expect(log.count()).toBe(0)
  })

  it('appends an event and reads it back as an unsynced row', () => {
    log.append(makeEvent({ toolName: 'Read', filePath: '/tmp/foo.ts' }))

    expect(log.count()).toBe(1)
    const unsynced = log.getUnsynced()
    expect(unsynced).toHaveLength(1)
    expect(unsynced[0].toolName).toBe('Read')
    expect(unsynced[0].filePath).toBe('/tmp/foo.ts')
    expect(unsynced[0].syncedAt).toBeNull()
  })

  it('round-trips argsScrubbed as JSON', () => {
    log.append(makeEvent({ argsScrubbed: { command: 'ls -la', description: 'list files' } }))
    const [row] = log.getUnsynced()
    expect(row.argsScrubbed).toEqual({ command: 'ls -la', description: 'list files' })
  })

  it('N appended events produce N rows', () => {
    const n = 7
    for (let i = 0; i < n; i++) {
      log.append(makeEvent({ sessionId: `sess-${i}` }))
    }
    expect(log.count()).toBe(n)
    expect(log.getUnsynced(100)).toHaveLength(n)
  })

  it('markSynced excludes rows from getUnsynced and updates pendingCount', () => {
    log.append(makeEvent())
    log.append(makeEvent())
    const rows = log.getUnsynced()
    expect(log.pendingCount()).toBe(2)

    log.markSynced([rows[0].id])

    expect(log.pendingCount()).toBe(1)
    const remaining = log.getUnsynced()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(rows[1].id)
    expect(log.lastSyncedAt()).not.toBeNull()
  })

  it('markSynced with an empty array is a no-op', () => {
    log.append(makeEvent())
    log.markSynced([])
    expect(log.pendingCount()).toBe(1)
  })
})

describe('detectSlug', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-slug-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads slug from .tages/config.json marker when present', () => {
    fs.mkdirSync(path.join(tmpDir, '.tages'))
    fs.writeFileSync(
      path.join(tmpDir, '.tages', 'config.json'),
      JSON.stringify({ slug: 'my-project' }),
    )
    expect(detectSlug(tmpDir)).toBe('my-project')
  })

  it('falls back to a sanitized directory name when no marker exists', () => {
    const projectDir = path.join(tmpDir, 'My Cool Project')
    fs.mkdirSync(projectDir)
    expect(detectSlug(projectDir)).toBe('my-cool-project')
  })

  it('falls back gracefully when the marker file is corrupt JSON', () => {
    fs.mkdirSync(path.join(tmpDir, '.tages'))
    fs.writeFileSync(path.join(tmpDir, '.tages', 'config.json'), '{not valid json')
    expect(detectSlug(tmpDir)).toBe(path.basename(tmpDir).toLowerCase())
  })
})

describe('getHarnessDbPath', () => {
  it('builds a path under ~/.config/tages/cache named <slug>-harness.db', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-dbpath-test-'))
    const dbPath = getHarnessDbPath(tmpDir)
    expect(dbPath).toContain(path.join('.config', 'tages', 'cache'))
    expect(dbPath.endsWith('-harness.db')).toBe(true)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
