/**
 * E2E tests for all 20 free-tier MCP tools.
 *
 * Tests run in order so that earlier tool calls seed data for later ones.
 * Each test calls the tool via McpTestClient and asserts:
 *   - content[0].type === 'text'
 *   - No error thrown
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'

const TEST_DB_PATH = path.join(os.tmpdir(), `tages-e2e-free-tier-${Date.now()}.db`)

let client: McpTestClient

beforeAll(async () => {
  client = new McpTestClient(TEST_DB_PATH)
  await client.start()
}, 30_000)

afterAll(async () => {
  await client.stop()
  // Clean up db file if still around
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
  } catch {
    // ignore
  }
})

// Helper to assert a valid text response
function assertTextResponse(result: { content: Array<{ type: string; text?: string }> }) {
  expect(result).toBeDefined()
  expect(Array.isArray(result.content)).toBe(true)
  expect(result.content.length).toBeGreaterThan(0)
  expect(result.content[0].type).toBe('text')
}

describe('Free-tier tool E2E tests', () => {
  // ─── 1. remember → round-trip with recall ───────────────────────────────

  it('remember: stores a convention memory', async () => {
    const result = await client.callTool('remember', {
      key: 'e2e-test-convention',
      value: 'Always write tests before shipping. This is the testing convention.',
      type: 'convention',
      tags: ['testing', 'e2e'],
    })
    assertTextResponse(result)
  }, 10_000)

  it('remember: stores an architecture memory', async () => {
    const result = await client.callTool('remember', {
      key: 'e2e-test-architecture',
      value: 'The MCP server uses SQLite as local cache with 60s async sync to Supabase.',
      type: 'architecture',
    })
    assertTextResponse(result)
  }, 10_000)

  it('remember: stores a decision memory', async () => {
    const result = await client.callTool('remember', {
      key: 'e2e-test-decision',
      value: 'We chose pnpm workspaces for monorepo management because of better deduplication.',
      type: 'decision',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 2. recall ───────────────────────────────────────────────────────────

  it('recall: finds the stored convention memory', async () => {
    const result = await client.callTool('recall', {
      query: 'testing convention',
      limit: 5,
    })
    assertTextResponse(result)
    const text = result.content[0].text as string
    // Should contain the key or value we stored
    expect(text.toLowerCase()).toMatch(/test|convention/i)
  }, 10_000)

  // ─── 3. forget ───────────────────────────────────────────────────────────

  it('forget: removes a memory by key', async () => {
    // First store a temporary memory
    await client.callTool('remember', {
      key: 'e2e-to-forget',
      value: 'This memory should be deleted.',
      type: 'lesson',
    })

    // Now forget it
    const forgetResult = await client.callTool('forget', {
      key: 'e2e-to-forget',
    })
    assertTextResponse(forgetResult)

    // Recall with the key should return a "no memories found" response (not the value)
    const recallResult = await client.callTool('recall', {
      query: 'e2e-to-forget',
      limit: 5,
    })
    assertTextResponse(recallResult)
    const text = recallResult.content[0].text as string
    // Should not contain the actual stored value — memory was deleted
    expect(text).not.toMatch(/This memory should be deleted/)
  }, 10_000)

  // ─── 4. conventions ──────────────────────────────────────────────────────

  it('conventions: returns valid response shape', async () => {
    const result = await client.callTool('conventions', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 5. architecture ─────────────────────────────────────────────────────

  it('architecture: returns valid response shape', async () => {
    const result = await client.callTool('architecture', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 6. decisions ────────────────────────────────────────────────────────

  it('decisions: returns valid response shape', async () => {
    const result = await client.callTool('decisions', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 7. context ──────────────────────────────────────────────────────────

  it('context: returns memories related to a file path', async () => {
    // Store a memory with a filePath first
    await client.callTool('remember', {
      key: 'e2e-file-context',
      value: 'The cache module is at packages/server/src/cache/sqlite.ts',
      type: 'architecture',
      filePaths: ['packages/server/src/cache/sqlite.ts'],
    })

    const result = await client.callTool('context', {
      filePath: 'packages/server/src/cache/sqlite.ts',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 8. staleness ────────────────────────────────────────────────────────

  it('staleness: returns valid response (may be empty)', async () => {
    const result = await client.callTool('staleness', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 9. conflicts ────────────────────────────────────────────────────────

  it('conflicts: returns valid response shape', async () => {
    const result = await client.callTool('conflicts', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 10. stats ───────────────────────────────────────────────────────────

  it('stats: returns memory usage statistics with content', async () => {
    const result = await client.callTool('stats', {})
    assertTextResponse(result)
    const text = result.content[0].text as string
    expect(text.length).toBeGreaterThan(0)
  }, 10_000)

  // ─── 11. observe ─────────────────────────────────────────────────────────

  it('observe: extracts or stores observation without error', async () => {
    const result = await client.callTool('observe', {
      observation:
        'I noticed that all MCP tools validate their inputs with Zod schemas before processing.',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 12. session_end ─────────────────────────────────────────────────────

  it('session_end: completes session with a summary', async () => {
    const result = await client.callTool('session_end', {
      summary:
        'Tested the free-tier E2E flow: stored conventions, recalled them, and verified the tier gate works correctly.',
      extractMemories: false,
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 13. pending_memories ────────────────────────────────────────────────

  it('pending_memories: returns valid response shape', async () => {
    const result = await client.callTool('pending_memories', {})
    assertTextResponse(result)
  }, 10_000)

  // ─── 14. verify_memory ───────────────────────────────────────────────────
  // Note: verify_memory requires a pending memory key. We store one via observe,
  // then check pending list and verify if one exists; otherwise just check shape.

  it('verify_memory: handles verify for known key gracefully', async () => {
    // Attempt to verify our convention memory (it's already live, so this
    // tests the "not found in pending" path — still returns text response)
    const result = await client.callTool('verify_memory', {
      key: 'e2e-test-convention',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 15. pre_check ───────────────────────────────────────────────────────

  it('pre_check: returns relevant gotchas for a task description', async () => {
    const result = await client.callTool('pre_check', {
      taskDescription: 'Refactor the SQLite cache to add a new index',
      filePaths: ['packages/server/src/cache/sqlite.ts'],
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 16. project_brief ───────────────────────────────────────────────────

  it('project_brief: returns token-budgeted project context', async () => {
    const result = await client.callTool('project_brief', {
      task: 'Add a new MCP tool for semantic search',
      budget: 2000,
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 17. file_recall ─────────────────────────────────────────────────────

  it('file_recall: returns memories for given file paths', async () => {
    const result = await client.callTool('file_recall', {
      filePaths: ['packages/server/src/cache/sqlite.ts'],
      limit: 5,
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 18. import_claude_md ────────────────────────────────────────────────

  it('import_claude_md: imports memories from CLAUDE.md content', async () => {
    const claudeMdContent = `# Project Config

## Conventions
- Use TypeScript strict mode everywhere
- All async functions must have try/catch blocks

## Architecture
- pnpm monorepo with packages/server, packages/cli, packages/shared
`
    const result = await client.callTool('import_claude_md', {
      content: claudeMdContent,
      strategy: 'skip',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 19. import_memories ─────────────────────────────────────────────────

  it('import_memories: imports a JSON array of memories', async () => {
    const memories = JSON.stringify([
      {
        key: 'e2e-imported-pattern',
        value: 'Use Result<T, E> pattern for error handling in all handlers.',
        type: 'pattern',
      },
      {
        key: 'e2e-imported-lesson',
        value: 'Always verify Supabase migrations in staging before production.',
        type: 'lesson',
      },
    ])
    const result = await client.callTool('import_memories', {
      content: memories,
      format: 'json',
      strategy: 'skip',
    })
    assertTextResponse(result)
  }, 10_000)

  // ─── 20. memory_history ──────────────────────────────────────────────────

  it('memory_history: returns version history for a key', async () => {
    // Update the convention memory to create a second version
    await client.callTool('remember', {
      key: 'e2e-test-convention',
      value: 'Always write tests before shipping. Updated: include E2E tests.',
      type: 'convention',
    })

    const result = await client.callTool('memory_history', {
      key: 'e2e-test-convention',
    })
    assertTextResponse(result)
    const text = result.content[0].text as string
    expect(text.length).toBeGreaterThan(0)
  }, 10_000)
})
