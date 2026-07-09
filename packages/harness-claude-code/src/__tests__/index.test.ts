import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleRawPayload, parseHookPayload } from '../index'
import { HarnessLog } from '../local-log'

function preToolUsePayload(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-abc',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello', description: 'say hello' },
    ...overrides,
  }
}

function postToolUsePayload(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-abc',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello', description: 'say hello' },
    tool_response: { stdout: 'hello\n', stderr: '', exit_code: 0, interrupted: false },
    ...overrides,
  }
}

describe('parseHookPayload', () => {
  it('parses a PreToolUse payload into the expected HarnessEvent shape', () => {
    const event = parseHookPayload(preToolUsePayload())
    expect(event).not.toBeNull()
    expect(event!.eventType).toBe('pre_tool_use')
    expect(event!.sessionId).toBe('sess-abc')
    expect(event!.toolName).toBe('Bash')
    expect(event!.source).toBe('claude_code_hook')
    expect(event!.argsScrubbed).toMatchObject({ command: 'echo hello' })
  })

  it('parses a PostToolUse payload, extracting exit_code from tool_response', () => {
    const event = parseHookPayload(postToolUsePayload())
    expect(event).not.toBeNull()
    expect(event!.eventType).toBe('post_tool_use')
    expect(event!.exitCode).toBe(0)
  })

  it('parses a PostToolUse payload for a tool with a file_path in tool_input', () => {
    const event = parseHookPayload(
      postToolUsePayload({
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/project/src/index.ts' },
        tool_response: { content: 'export const x = 1' },
      }),
    )
    expect(event).not.toBeNull()
    expect(event!.toolName).toBe('Read')
    expect(event!.filePath).toBe('/tmp/project/src/index.ts')
  })

  it('parses a SessionEnd payload', () => {
    const event = parseHookPayload({
      session_id: 'sess-abc',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/project',
      hook_event_name: 'SessionEnd',
      reason: 'clear',
    })
    expect(event).not.toBeNull()
    expect(event!.eventType).toBe('session_end')
    expect(event!.resultSummary).toBe('clear')
  })

  it('parses a Stop payload', () => {
    const event = parseHookPayload({
      session_id: 'sess-abc',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/project',
      hook_event_name: 'Stop',
      stop_hook_active: true,
    })
    expect(event).not.toBeNull()
    expect(event!.eventType).toBe('stop')
    expect(event!.resultSummary).toContain('true')
  })

  it('derives durationMs by pairing PreToolUse and PostToolUse in the same process', () => {
    const pre = parseHookPayload(preToolUsePayload({ tool_name: 'Grep' }))
    expect(pre).not.toBeNull()
    expect(pre!.durationMs).toBeNull()

    const post = parseHookPayload(
      postToolUsePayload({ tool_name: 'Grep', tool_input: {}, tool_response: {} }),
    )
    expect(post).not.toBeNull()
    expect(post!.durationMs).not.toBeNull()
    expect(post!.durationMs!).toBeGreaterThanOrEqual(0)
  })

  it('returns null for an unrecognized hook_event_name (fails closed)', () => {
    expect(parseHookPayload({ session_id: 's', hook_event_name: 'SomeFutureHook' })).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    expect(parseHookPayload({ hook_event_name: 'PreToolUse' })).toBeNull()
    expect(parseHookPayload({ session_id: 's' })).toBeNull()
  })

  it('returns null for non-object input without throwing', () => {
    expect(parseHookPayload(null)).toBeNull()
    expect(parseHookPayload(undefined)).toBeNull()
    expect(parseHookPayload('not an object')).toBeNull()
    expect(parseHookPayload(42)).toBeNull()
    expect(parseHookPayload([1, 2, 3])).toBeNull()
  })

  it('redacts a secret embedded in tool_input before returning the event', () => {
    const fakeAwsKey = 'AKIAABCDEFGHIJKLMNOP'
    const event = parseHookPayload(
      preToolUsePayload({
        tool_input: { command: `export AWS_KEY=${fakeAwsKey}` },
      }),
    )
    expect(event).not.toBeNull()
    const serialized = JSON.stringify(event!.argsScrubbed)
    expect(serialized).not.toContain(fakeAwsKey)
    expect(event!.secretsRedactedCount).toBeGreaterThan(0)
  })

  it('caps an oversized field instead of storing it verbatim (no uncapped diffs)', () => {
    const hugeString = 'x'.repeat(5000)
    const event = parseHookPayload(
      preToolUsePayload({
        tool_name: 'Edit',
        tool_input: { file_path: '/tmp/a.ts', old_string: hugeString, new_string: hugeString },
      }),
    )
    expect(event).not.toBeNull()
    const oldStringOut = (event!.argsScrubbed as Record<string, unknown>).old_string as string
    expect(oldStringOut.length).toBeLessThan(hugeString.length)
    expect(oldStringOut).toContain('truncated')
  })
})

describe('handleRawPayload', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-index-test-'))
    dbPath = path.join(tmpDir, 'test-harness.db')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('malformed JSON does not crash and produces no row', () => {
    let result: ReturnType<typeof handleRawPayload> = null
    expect(() => {
      result = handleRawPayload('{not valid json', { dbPath })
    }).not.toThrow()
    expect(result).toBeNull()
  })

  it('an unrecognized-but-valid JSON payload does not crash and produces no row', () => {
    const result = handleRawPayload(JSON.stringify({ foo: 'bar' }), { dbPath })
    expect(result).toBeNull()
  })

  it('a valid PreToolUse payload produces exactly one row in the local db', () => {
    handleRawPayload(JSON.stringify(preToolUsePayload()), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      expect(log.count()).toBe(1)
    } finally {
      log.close()
    }
  })

  it('N valid events produce N rows', () => {
    const n = 5
    for (let i = 0; i < n; i++) {
      handleRawPayload(JSON.stringify(preToolUsePayload({ session_id: `sess-${i}` })), { dbPath })
    }

    const log = new HarnessLog(dbPath)
    try {
      expect(log.count()).toBe(n)
    } finally {
      log.close()
    }
  })

  it('a payload with a fake AWS key and a password field produces a DB row with no literal secret substring', () => {
    const fakeAwsKey = 'AKIAABCDEFGHIJKLMNOP'
    const fakePassword = 'hunter2hunter2superSecret'
    const payload = preToolUsePayload({
      tool_input: {
        command: `export AWS_KEY=${fakeAwsKey} && export password=${fakePassword}`,
      },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain(fakeAwsKey)
      expect(serializedRow).not.toContain(fakePassword)
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
    } finally {
      log.close()
    }
  })
})
