import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'
import { PRO_TOOLS, FREE_TOOLS } from '../tier-config'
import * as os from 'os'
import * as path from 'path'

// The upgrade message prefix defined in tier-gate.ts
const UPGRADE_MSG_PREFIX = 'This tool requires Tages Pro'

// SENTINEL: update this URL after domain cutover to tages.ai
const UPGRADE_URL_SENTINEL = 'dashboard-weld-nine-65.vercel.app'

/**
 * Minimal valid args for each Pro tool.
 *
 * IMPORTANT: The MCP SDK validates Zod schemas BEFORE calling the handler.
 * withGate() fires inside the handler, so for tools with required fields,
 * we must pass schema-valid args — the gate check never fires without them.
 *
 * For tools with no required args (all optional or empty schema), we use {}.
 */
const PRO_TOOL_ARGS: Record<string, Record<string, unknown>> = {
  // No args required
  memory_stats_detail: {},
  list_conflicts: {},
  suggestions: {},
  memory_graph: {},
  risk_report: {},
  graph_analysis: {},
  enforcement_report: {},
  project_health: {},
  list_templates: {},
  archive_stats: {},
  federation_overrides: {},
  memory_audit: {},

  // Optional args only — use {}
  detect_duplicates: {},
  list_archived: {},
  auto_archive: {},
  list_federated: {},
  agent_metrics: {},
  trends: {},

  // Required args
  contextual_recall: { query: '' },
  resolve_conflict: { conflictId: 'fake-conflict-id', strategy: 'keep_newer' },
  fork_branch: { sessionId: 'test-gate-session' },
  merge_branch: { sessionId: 'test-gate-session', strategy: 'force' },
  list_branches: { sessionId: 'test-gate-session' },
  consolidate_memories: { survivorKey: 'key-a', victimKey: 'key-b' },
  impact_analysis: { key: 'test-key' },
  check_convention: { key: 'test-key' },
  memory_quality: { key: 'test-key' },
  match_templates: { filePaths: ['src/test.ts'] },
  apply_template: { templateId: 'api-endpoint', fields: { name: 'test' } },
  archive_memory: { key: 'test-key' },
  restore_memory: { key: 'test-key' },
  federate_memory: { key: 'test-key' },
  import_federated: { key: 'test-key' },
  session_replay: { sessionId: 'fake-session-id' },
  sharpen_memory: { key: 'test-key' },
  post_session: { summary: 'test session summary for gate check' },
}

describe('E2E: complete Pro tool gating on free tier (all 36 tools)', { timeout: 120_000 }, () => {
  let client: McpTestClient
  const dbPath = path.join(os.tmpdir(), `tages-e2e-pro-gating-complete-${Date.now()}.db`)

  beforeAll(async () => {
    // Server starts with no plan config = free tier by default
    client = new McpTestClient(dbPath)
    await client.start()
  }, 30000)

  afterAll(async () => {
    await client.stop()
  })

  it('PRO_TOOLS array contains exactly 36 tools', () => {
    expect(PRO_TOOLS).toHaveLength(36)
  })

  it('all 36 Pro tools return upgrade message on free tier', async () => {
    for (const toolName of PRO_TOOLS) {
      const args = PRO_TOOL_ARGS[toolName] ?? {}
      const result = await client.callTool(toolName, args)

      expect(result, `Tool ${toolName} should return a result`).toBeDefined()
      expect(result.content, `Tool ${toolName} should have content array`).toBeDefined()
      expect(result.content.length, `Tool ${toolName} content should be non-empty`).toBeGreaterThan(0)

      const text = result.content[0].text
      expect(text, `Tool ${toolName} should be gated with upgrade message`).toMatch(/pro|upgrade/i)
      expect(text, `Tool ${toolName} should contain the upgrade prefix`).toContain(UPGRADE_MSG_PREFIX)
    }
  }, 90000)

  it('upgrade URL sentinel is present in Pro tool gate response (pre-cutover)', async () => {
    // SENTINEL: update this URL after domain cutover to tages.ai
    const result = await client.callTool('memory_stats_detail', {})
    const text = result.content[0].text
    expect(text).toContain(UPGRADE_URL_SENTINEL)
  }, 15000)

  it('no Pro tool throws an exception when called on free tier', async () => {
    for (const toolName of PRO_TOOLS) {
      const args = PRO_TOOL_ARGS[toolName] ?? {}
      await expect(
        client.callTool(toolName, args),
        `Tool ${toolName} should resolve without throwing`,
      ).resolves.toBeDefined()
    }
  }, 90000)

  it('all 20 Free tools do NOT return upgrade message', async () => {
    // Minimal valid args for free tools that have required fields
    const FREE_TOOL_ARGS: Record<string, Record<string, unknown>> = {
      remember: { key: 'test-free', value: 'test value', type: 'convention' },
      recall: { query: 'test' },
      forget: { key: 'test-free' },
      conventions: {},
      architecture: {},
      decisions: {},
      context: { filePath: 'src/test.ts' },
      staleness: {},
      conflicts: {},
      stats: {},
      observe: { observation: 'Testing free tool access' },
      session_end: { summary: 'Test session' },
      verify_memory: { key: 'test-key' },
      pending_memories: {},
      pre_check: { taskDescription: 'Write a test' },
      project_brief: {},
      file_recall: { filePaths: ['src/test.ts'] },
      import_claude_md: { content: '# CLAUDE.md\n\nTest content' },
      import_memories: { content: '[]' },
      memory_history: { key: 'test-key' },
    }

    for (const toolName of FREE_TOOLS) {
      const args = FREE_TOOL_ARGS[toolName] ?? {}
      const result = await client.callTool(toolName, args)

      expect(result, `Free tool ${toolName} should return a result`).toBeDefined()

      if (result.content && result.content.length > 0) {
        const text = result.content[0].text
        expect(text, `Free tool ${toolName} should NOT be gated`).not.toContain(UPGRADE_MSG_PREFIX)
      }
    }
  }, 90000)
})
