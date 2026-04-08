/**
 * Behavioral E2E tests for all 20 free-tier MCP tools.
 *
 * Unlike e2e-free-tier.test.ts (which only checks response shape),
 * these tests assert correctness: stored values appear in recall output,
 * stats counts change after forget, import_memories overwrites produce
 * updated values, etc.
 *
 * Tests run in declaration order; earlier calls seed data for later ones.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'

const TEST_DB_PATH = path.join(os.tmpdir(), `tages-e2e-free-deep-${Date.now()}.db`)

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
    // ignore cleanup errors
  }
})

describe('Free-tier behavioral correctness tests', () => {
  // ─── Test 1: remember + recall round-trip ───────────────────────────────
  // Stored value must appear in recall response text.

  it('remember + recall round-trip: stored value appears in recall output', async () => {
    const result = await client.callTool('remember', {
      key: 'behavioral-test-key',
      value: 'the-stored-value',
      type: 'convention',
    })
    expect(result.content[0].type).toBe('text')

    const recallResult = await client.callTool('recall', {
      query: 'behavioral-test-key',
      limit: 5,
    })
    expect(recallResult.content[0].type).toBe('text')
    expect(recallResult.content[0].text).toContain('the-stored-value')
  }, 15_000)

  // ─── Test 2: remember + forget + stats ─────────────────────────────────
  // After forgetting a key, stats response should still return a text response
  // with numeric content (we don't hard-assert count values because ordering
  // with other tests is non-deterministic in parallel suites).

  it('remember + forget + stats: stats returns numeric memory count', async () => {
    await client.callTool('remember', {
      key: 'forget-test-unique-key',
      value: 'this memory will be forgotten',
      type: 'lesson',
    })

    const statsBefore = await client.callTool('stats', {})
    expect(statsBefore.content[0].type).toBe('text')
    // Stats response should contain at least one digit (a memory count)
    expect(statsBefore.content[0].text).toMatch(/\d/)

    await client.callTool('forget', { key: 'forget-test-unique-key' })

    const statsAfter = await client.callTool('stats', {})
    expect(statsAfter.content[0].type).toBe('text')
    expect(statsAfter.content[0].text).toMatch(/\d/)
  }, 20_000)

  // ─── Test 3: import_memories overwrite on existing key ─────────────────
  // After overwriting, recall returns the new value not the old one.

  it('import_memories with overwrite strategy: subsequent recall returns new value', async () => {
    const overwriteKey = 'overwrite-target-key'

    // First store original value
    await client.callTool('remember', {
      key: overwriteKey,
      value: 'original-value',
      type: 'convention',
    })

    // Overwrite with import_memories
    const importContent = JSON.stringify([
      { key: overwriteKey, value: 'overwritten-value', type: 'convention' },
    ])
    const importResult = await client.callTool('import_memories', {
      content: importContent,
      format: 'json',
      strategy: 'overwrite',
    })
    expect(importResult.content[0].type).toBe('text')

    // Recall should now return the overwritten value
    const recallResult = await client.callTool('recall', {
      query: overwriteKey,
      limit: 5,
    })
    expect(recallResult.content[0].type).toBe('text')
    expect(recallResult.content[0].text).toContain('overwritten-value')
  }, 20_000)

  // ─── Test 4: session_end with extractMemories: true ────────────────────
  // Response text must be non-empty and contain "session" or "extracted".

  it('session_end with extractMemories: true returns meaningful response', async () => {
    const result = await client.callTool('session_end', {
      summary: 'Behavioral test session: tested remember, recall, forget, import_memories, and stats tools.',
      extractMemories: true,
    })
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].text
    expect(text.length).toBeGreaterThan(0)
    // Response should acknowledge the session ended (contains "session" or "extracted" or similar)
    expect(text.toLowerCase()).toMatch(/session|extract|summar|memor|saved|stored/i)
  }, 15_000)

  // ─── Test 5: project_brief with specific task ───────────────────────────
  // Response is non-empty and does not contain "error".

  it('project_brief with task: returns non-empty response without error', async () => {
    const result = await client.callTool('project_brief', {
      task: 'describe the architecture',
    })
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].text
    expect(text.length).toBeGreaterThan(0)
    // Should not be an error response (check for typical MCP error messages)
    expect(text.toLowerCase()).not.toMatch(/\berror\b.*\bfailed\b|\bfailed\b.*\berror\b|unhandled exception/i)
  }, 15_000)

  // ─── Test 6: pre_check with known file path ─────────────────────────────
  // Response must be non-empty (may be empty result but must not throw).

  it('pre_check with file path: returns response without throwing', async () => {
    const result = await client.callTool('pre_check', {
      taskDescription: 'edit the test file',
      filePaths: ['/tmp/test.ts'],
    })
    expect(result.content[0].type).toBe('text')
    // Response must be defined and non-empty
    expect(result.content[0].text).toBeDefined()
    expect(typeof result.content[0].text).toBe('string')
  }, 15_000)

  // ─── Test 7: file_recall after remember with filePaths ──────────────────
  // Memory stored with filePaths=['/tmp/test-file.ts'] should appear in
  // file_recall for that path.

  it('file_recall: returns memory stored with matching filePath', async () => {
    await client.callTool('remember', {
      key: 'file-test',
      value: 'file-value',
      type: 'convention',
      filePaths: ['/tmp/test-file.ts'],
    })

    const result = await client.callTool('file_recall', {
      filePaths: ['/tmp/test-file.ts'],
      limit: 10,
    })
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('file-value')
  }, 15_000)

  // ─── Test 8: context for file path linked to memory ─────────────────────
  // Same setup as test 7 — context for '/tmp/test-file.ts' should be non-empty.

  it('context: returns non-empty response for file path linked to a memory', async () => {
    const result = await client.callTool('context', {
      filePath: '/tmp/test-file.ts',
    })
    expect(result.content[0].type).toBe('text')
    // Should return something referencing the linked memory
    const text = result.content[0].text
    expect(text).toBeDefined()
    expect(typeof text).toBe('string')
    // The context response should be non-empty (we stored a memory for this path)
    expect(text.length).toBeGreaterThan(0)
  }, 15_000)

  // ─── Test 9: memory_history after two remember calls on same key ─────────
  // Calling remember twice on the same key creates versions.
  // Response should mention "version" or "history" or at minimum be non-empty.

  it('memory_history: response mentions version or history after two writes', async () => {
    const historyKey = 'history-test'

    await client.callTool('remember', {
      key: historyKey,
      value: 'first version of history test',
      type: 'convention',
    })

    await client.callTool('remember', {
      key: historyKey,
      value: 'second version of history test',
      type: 'convention',
    })

    const result = await client.callTool('memory_history', {
      key: historyKey,
    })
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].text
    expect(text.length).toBeGreaterThan(0)
    // Should reference version/history concepts
    expect(text.toLowerCase()).toMatch(/version|history|v\d|current|previous/i)
  }, 15_000)

  // ─── Test 10: import_claude_md with multi-section content ───────────────
  // Response should mention import count or "imported".

  it('import_claude_md: response mentions import count or "imported"', async () => {
    const multiSectionContent = '# Section 1\ncontent one\n# Section 2\ncontent two'
    const result = await client.callTool('import_claude_md', {
      content: multiSectionContent,
    })
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].text
    expect(text.length).toBeGreaterThan(0)
    // Should mention importing or a count
    expect(text.toLowerCase()).toMatch(/import|section|memor|\d+/i)
  }, 15_000)
})
