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

  it('F3: a secret nested two levels deep produces a DB row with no literal secret substring', () => {
    // Self-identifying secret (AWS access key) two levels deep — structural
    // recursion must reach the leaf; the old stringify-then-scan on keyed
    // patterns could not.
    const awsKey = 'AKIAIOSFODNN7EXAMPLE'
    // A keyed secret whose VALUE is not self-identifying — only the object key
    // (`api_key`) marks it sensitive. The old code stored this raw because
    // JSON's `"api_key":"..."` never matched the `api_key=...` pattern.
    const opaqueApiKey = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const payload = preToolUsePayload({
      tool_name: 'Bash',
      tool_input: {
        config: {
          credentials: { aws_key: awsKey },
          api_key: opaqueApiKey,
        },
      },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain(awsKey)
      expect(serializedRow).not.toContain(opaqueApiKey)
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
      // Structure preserved, just with redacted leaves.
      const args = rows[0].argsScrubbed as Record<string, unknown>
      expect(args.config).toBeTypeOf('object')
    } finally {
      log.close()
    }
  })

  it('F3: a secret inside an array produces a DB row with no literal secret substring', () => {
    const awsKey = 'AKIAIOSFODNN7EXAMPLE'
    const payload = preToolUsePayload({
      tool_name: 'Bash',
      tool_input: { items: ['harmless', awsKey, 'also-harmless'] },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain(awsKey)
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
      const args = rows[0].argsScrubbed as Record<string, unknown>
      expect(Array.isArray(args.items)).toBe(true)
      // Harmless siblings survive — no over-redaction of the whole array.
      expect(args.items as unknown[]).toContain('harmless')
    } finally {
      log.close()
    }
  })

  it('B1-array: a bare secret split across two argv elements (["--secret-access-key","<40>"]) is redacted', () => {
    // The value element carries no adjacent marker; the redaction must derive a
    // key hint from the preceding CLI flag. This shape is reachable via MCP/custom
    // tools that pass a pre-split argv array (Tages is itself an MCP server).
    const bareSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    const payload = preToolUsePayload({
      tool_name: 'CustomMcpTool',
      tool_input: { argv: ['aws', 'configure', 'set', '--secret-access-key', bareSecret] },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain(bareSecret)
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
    } finally {
      log.close()
    }
  })

  it('B1-array: a benign flag+value pair (["--verbose","true"]) is NOT over-redacted', () => {
    const payload = preToolUsePayload({
      tool_name: 'CustomMcpTool',
      tool_input: { argv: ['--verbose', 'true', '--count', '42'] },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      expect(rows[0].secretsRedactedCount).toBe(0)
      const args = rows[0].argsScrubbed as Record<string, unknown>
      expect(args.argv as unknown[]).toEqual(['--verbose', 'true', '--count', '42'])
    } finally {
      log.close()
    }
  })

  it('F4: a card number sent as a JSON number is redacted at the persisted-row level', () => {
    const card = 4111111111111111
    const payload = preToolUsePayload({
      tool_name: 'Bash',
      tool_input: { card },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain('4111111111111111')
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
    } finally {
      log.close()
    }
  })

  it('F4: an SSN sent as a JSON number is redacted at the persisted-row level', () => {
    const ssn = 123456789
    const payload = preToolUsePayload({
      tool_name: 'Bash',
      tool_input: { ssn },
    })

    handleRawPayload(JSON.stringify(payload), { dbPath })

    const log = new HarnessLog(dbPath)
    try {
      const rows = log.getUnsynced()
      expect(rows).toHaveLength(1)
      const serializedRow = JSON.stringify(rows[0])
      expect(serializedRow).not.toContain('123456789')
      expect(rows[0].secretsRedactedCount).toBeGreaterThan(0)
    } finally {
      log.close()
    }
  })

  it('F4: an ordinary number (line count) keeps its numeric type, not over-redacted', () => {
    const payload = preToolUsePayload({
      tool_name: 'Bash',
      tool_input: { limit: 42 },
    })
    const event = parseHookPayload(payload)
    expect(event).not.toBeNull()
    expect((event!.argsScrubbed as Record<string, unknown>).limit).toBe(42)
    expect(event!.secretsRedactedCount).toBe(0)
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
