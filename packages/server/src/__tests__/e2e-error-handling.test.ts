/**
 * E2E tests for MCP server error handling paths.
 *
 * Tests cover:
 *   - Secret detection blocking
 *   - Force override of secret detection
 *   - Graceful handling of nonexistent keys
 *   - Unknown tool name handling
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'

const TEST_DB_PATH = path.join(os.tmpdir(), `tages-e2e-error-handling-${Date.now()}.db`)

let client: McpTestClient

beforeAll(async () => {
  client = new McpTestClient(TEST_DB_PATH)
  await client.start()
}, 30_000)

afterAll(async () => {
  await client.stop()
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  } catch {
    // ignore
  }
})

describe('MCP server error handling', () => {
  // ─── 1. Secret detection blocks remember ─────────────────────────────────

  it('secret detection: remember with AWS key is blocked', async () => {
    const result = await client.callTool('remember', {
      key: 'e2e-error-secret-test',
      value: 'My AWS key is AKIAIOSFODNN7EXAMPLE and should be blocked.',
      type: 'convention',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')

    const text = result.content[0].text as string
    // Should indicate blocking — not crash
    expect(text).toMatch(/blocked|secret|detected/i)
  }, 10_000)

  // ─── 2. Force override bypasses secret detection ──────────────────────────

  it('secret detection: force:true overrides block and succeeds', async () => {
    const result = await client.callTool('remember', {
      key: 'e2e-error-secret-force',
      value: 'My AWS key is AKIAIOSFODNN7EXAMPLE stored with force override.',
      type: 'convention',
      force: true,
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')

    const text = result.content[0].text as string
    // Should NOT say blocked — force override worked
    expect(text).not.toMatch(/^Blocked:/i)
  }, 10_000)

  // ─── 3. Forget nonexistent key — graceful, no crash ──────────────────────

  it('forget: nonexistent key returns text response without crashing', async () => {
    const result = await client.callTool('forget', {
      key: 'nonexistent-key-12345',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')
  }, 10_000)

  // ─── 4. memory_history nonexistent key — graceful, no crash ──────────────

  it('memory_history: nonexistent key returns text response without crashing', async () => {
    const result = await client.callTool('memory_history', {
      key: 'nonexistent-key-12345',
    })
    expect(result).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')
  }, 10_000)

  // ─── 5. Unknown tool name — returns error or text, server does not crash ──

  it('unknown tool: nonexistent_tool_xyz returns error or text without crashing', async () => {
    let caughtError: Error | null = null
    let result: { content: Array<{ type: string; text?: string }> } | null = null

    try {
      result = await client.callTool('nonexistent_tool_xyz', {})
    } catch (err) {
      caughtError = err as Error
    }

    // The server must not crash silently — either:
    //   (a) it throws an error (MCP error response), OR
    //   (b) it returns a text response indicating the tool is unknown
    if (caughtError !== null) {
      // Path (a): error thrown — verify it has a message
      expect(caughtError.message).toBeTruthy()
    } else {
      // Path (b): returned a result — must be a valid text response
      expect(result).not.toBeNull()
      expect(Array.isArray(result!.content)).toBe(true)
      expect(result!.content.length).toBeGreaterThan(0)
      expect(result!.content[0].type).toBe('text')
    }
  }, 10_000)
})
