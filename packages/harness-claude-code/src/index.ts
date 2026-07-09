#!/usr/bin/env node
/**
 * Claude Code hook capture bin for the Tages instrumented harness.
 *
 * Installed via `tages harness enable` as a PreToolUse/PostToolUse/
 * SessionEnd/Stop hook command in the developer's own
 * .claude/settings.local.json. Claude Code invokes this binary once per
 * hook firing and pipes a single JSON payload on stdin; this process reads
 * it, normalizes + redacts it, appends one row to the local SQLite log, and
 * exits 0.
 *
 * FAIL CLOSED AND SILENT: this runs synchronously in the agent's live turn.
 * Any error here — malformed JSON, an unrecognized payload shape, a SQLite
 * write failure — must never throw, print blocking output, or return a
 * non-zero exit code. Worst case is a dropped event, never a blocked tool
 * call.
 */
import * as fs from 'fs'
import { redactSensitiveData } from '@tages/shared'
import type { HarnessEvent, HarnessEventType } from '@tages/shared'
import { getHarnessDbPath, HarnessLog } from './local-log'

const SOURCE = 'claude_code_hook'

/** Longest a single scrubbed field is allowed to be, post-redaction. Keeps
 * v1 capture to "tool name, scrubbed args/paths, exit codes, durations,
 * timestamps" — not uncapped file contents or full diffs (out of scope per
 * PLAN-INSTRUMENTED-HARNESS.md). Edit's old_string/new_string and Write's
 * content are exactly the fields this caps. */
const MAX_FIELD_LENGTH = 500

// In-process PreToolUse -> start-time cache, keyed by session+tool, used to
// derive duration_ms for the matching PostToolUse. The hook protocol itself
// provides no duration_ms field (verified contract, see SPLIT's Howler-B
// brief) — pairing is opportunistic and only works within one warm process;
// if Claude Code spawns a fresh process per hook invocation (the more likely
// case), this cache is empty on every call and durationMs is always null,
// which is a valid, documented HarnessEvent value, not a bug.
const preToolUseStarts = new Map<string, number>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Redacts and caps a single raw value down to a persistable string. */
function scrubFieldValue(value: unknown): { value: string; redactedCount: number } {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  const { redacted, count } = redactSensitiveData(raw)
  if (redacted.length <= MAX_FIELD_LENGTH) {
    return { value: redacted, redactedCount: count }
  }
  const truncated = `${redacted.slice(0, MAX_FIELD_LENGTH)}…[truncated, ${redacted.length} chars total]`
  return { value: truncated, redactedCount: count }
}

/** Redacts + caps every value in a tool_input/tool_response-shaped object.
 * Non-string, non-object primitives (booleans, numbers, null) pass through
 * unscrubbed — they can't carry secrets or uncapped content. */
function scrubRecord(record: Record<string, unknown> | null): { scrubbed: Record<string, unknown> | null; redactedCount: number } {
  if (!record) return { scrubbed: null, redactedCount: 0 }

  let redactedCount = 0
  const scrubbed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) {
      scrubbed[key] = value ?? null
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      scrubbed[key] = value
      continue
    }
    const { value: scrubbedValue, redactedCount: fieldCount } = scrubFieldValue(value)
    scrubbed[key] = scrubbedValue
    redactedCount += fieldCount
  }

  return { scrubbed, redactedCount }
}

interface RawHookPayload {
  session_id?: unknown
  transcript_path?: unknown
  cwd?: unknown
  hook_event_name?: unknown
  tool_name?: unknown
  tool_input?: unknown
  tool_response?: unknown
  reason?: unknown
  stop_hook_active?: unknown
  [key: string]: unknown
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Parses one raw Claude Code hook JSON payload into a normalized,
 * already-redacted HarnessEvent, or returns null for anything unrecognized.
 *
 * All knowledge of the hook protocol's actual field names lives in this one
 * function (per the plan's Task 2b pre-mortem) — if Claude Code's payload
 * shape ever changes, this is the only place that needs to change.
 *
 * Verified contract (not a guess — see SPLIT-INSTRUMENTED-HARNESS.md's
 * Howler-B brief): common fields on every event are session_id,
 * transcript_path, cwd, hook_event_name. PreToolUse/PostToolUse add
 * tool_name + tool_input (+ tool_response for PostToolUse). SessionEnd adds
 * reason. Stop adds stop_hook_active. There is no top-level exit_code or
 * duration_ms; exit status (when present at all) lives inside
 * tool_response, and file_path lives inside tool_input.
 */
export function parseHookPayload(raw: unknown): HarnessEvent | null {
  try {
    if (!isRecord(raw)) return null
    const payload = raw as RawHookPayload

    const sessionId = str(payload.session_id)
    const hookEventName = str(payload.hook_event_name)
    if (!sessionId || !hookEventName) return null

    let eventType: HarnessEventType
    let toolName: string | null = null
    let rawFilePath: string | null = null
    let exitCode: number | null = null
    let durationMs: number | null = null
    let argsRecord: Record<string, unknown> | null = null
    let rawResultSummary: string | null = null

    switch (hookEventName) {
      case 'PreToolUse': {
        eventType = 'pre_tool_use'
        toolName = str(payload.tool_name)
        const input = isRecord(payload.tool_input) ? payload.tool_input : null
        argsRecord = input
        rawFilePath = input && typeof input.file_path === 'string' ? input.file_path : null
        if (toolName) {
          preToolUseStarts.set(`${sessionId}:${toolName}`, Date.now())
        }
        break
      }
      case 'PostToolUse': {
        eventType = 'post_tool_use'
        toolName = str(payload.tool_name)
        const input = isRecord(payload.tool_input) ? payload.tool_input : null
        const response = isRecord(payload.tool_response) ? payload.tool_response : null
        argsRecord = input
        rawFilePath = input && typeof input.file_path === 'string' ? input.file_path : null

        if (response) {
          // Bash's tool_response may carry an exit status; absent for most
          // other tools. Never fabricate a value when it's not present.
          const code = response.exit_code ?? response.exitCode
          if (typeof code === 'number') exitCode = code

          if (typeof response.stderr === 'string' && response.stderr.length > 0) {
            rawResultSummary = response.stderr
          } else if (typeof response.error === 'string') {
            rawResultSummary = response.error
          } else if (typeof response.interrupted === 'boolean') {
            rawResultSummary = response.interrupted ? 'interrupted' : 'completed'
          }
        }

        if (toolName) {
          const key = `${sessionId}:${toolName}`
          const start = preToolUseStarts.get(key)
          if (start !== undefined) {
            durationMs = Date.now() - start
            preToolUseStarts.delete(key)
          }
        }
        break
      }
      case 'SessionEnd': {
        eventType = 'session_end'
        rawResultSummary = str(payload.reason)
        break
      }
      case 'Stop': {
        eventType = 'stop'
        rawResultSummary = typeof payload.stop_hook_active === 'boolean'
          ? `stop_hook_active=${payload.stop_hook_active}`
          : null
        break
      }
      default:
        // Unrecognized hook_event_name — fail closed, nothing to capture.
        return null
    }

    // Redact + cap BEFORE constructing the returned event. Nothing raw ever
    // leaves this function.
    const { scrubbed: argsScrubbed, redactedCount: argsRedactedCount } = scrubRecord(argsRecord)

    let filePath: string | null = null
    let filePathRedactedCount = 0
    if (rawFilePath) {
      const result = redactSensitiveData(rawFilePath)
      filePath = result.redacted
      filePathRedactedCount = result.count
    }

    let resultSummary: string | null = null
    let summaryRedactedCount = 0
    if (rawResultSummary) {
      const { value, redactedCount } = scrubFieldValue(rawResultSummary)
      resultSummary = value
      summaryRedactedCount = redactedCount
    }

    const event: HarnessEvent = {
      source: SOURCE,
      sessionId,
      eventType,
      agentName: str(process.env.TAGES_AGENT_NAME),
      toolName,
      exitCode,
      filePath,
      durationMs,
      argsScrubbed,
      resultSummary,
      secretsRedactedCount: argsRedactedCount + filePathRedactedCount + summaryRedactedCount,
      createdAt: new Date().toISOString(),
    }

    return event
  } catch {
    // Any unexpected shape/parsing error fails closed — never throw out of
    // a hook invocation.
    return null
  }
}

/**
 * Full pipeline: parse a raw JSON string, normalize + redact it, and append
 * one row to the local SQLite log. Exported separately from main() so tests
 * can drive it directly (with an injected cwd/dbPath) instead of mocking
 * stdin/process.exit.
 *
 * Fails closed and silent at every stage: invalid JSON, an unrecognized
 * payload, or a local-log write failure all resolve to "nothing captured,"
 * never a thrown error.
 */
export function handleRawPayload(
  rawInput: string,
  opts?: { dbPath?: string; cwd?: string },
): HarnessEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(rawInput)
  } catch {
    return null
  }

  const event = parseHookPayload(raw)
  if (!event) return null

  try {
    const cwd = opts?.cwd
      ?? (isRecord(raw) && typeof raw.cwd === 'string' ? raw.cwd : process.cwd())
    const dbPath = opts?.dbPath ?? getHarnessDbPath(cwd)
    const log = new HarnessLog(dbPath)
    try {
      log.append(event)
    } finally {
      log.close()
    }
  } catch {
    // A local-log write failure must never propagate — the event was still
    // parsed correctly, just not persisted this time.
  }

  return event
}

export function main(): void {
  try {
    const raw = fs.readFileSync(0, 'utf-8')
    handleRawPayload(raw)
  } catch {
    // Includes "no stdin piped" and any other read failure — fail closed.
  }
  // Hooks must never block or fail the agent's tool call.
  process.exit(0)
}

if (require.main === module) {
  main()
}
