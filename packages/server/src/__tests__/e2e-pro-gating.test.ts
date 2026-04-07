import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'
import * as os from 'os'
import * as path from 'path'

// The upgrade message prefix defined in tier-gate.ts
const UPGRADE_MSG_PREFIX = 'This tool requires Tages Pro'

describe('E2E: pro tool gating on free tier', () => {
  let client: McpTestClient
  const dbPath = path.join(os.tmpdir(), `tages-e2e-pro-gating-${Date.now()}.db`)

  beforeAll(async () => {
    // Server starts with no plan config = free tier by default
    client = new McpTestClient(dbPath)
    await client.start()
  }, 30000)

  afterAll(async () => {
    await client.stop()
  })

  function assertUpgradeResponse(result: { content: Array<{ type: string; text: string }> }, toolName: string) {
    expect(result.content[0].type).toBe('text')
    const text = result.content[0].text
    expect(text).toMatch(/Pro|upgrade/i)
    expect(text).toContain(UPGRADE_MSG_PREFIX)
    expect(text).toContain(toolName)
  }

  it('memory_stats_detail returns upgrade message on free tier', async () => {
    const result = await client.callTool('memory_stats_detail', {})
    assertUpgradeResponse(result, 'memory_stats_detail')
  }, 15000)

  it('contextual_recall returns upgrade message on free tier', async () => {
    const result = await client.callTool('contextual_recall', { query: 'test query' })
    assertUpgradeResponse(result, 'contextual_recall')
  }, 15000)

  it('resolve_conflict returns upgrade message on free tier', async () => {
    const result = await client.callTool('resolve_conflict', {
      conflictId: 'fake-conflict-id',
      strategy: 'keep_newer',
    })
    assertUpgradeResponse(result, 'resolve_conflict')
  }, 15000)

  it('memory_graph returns upgrade message on free tier', async () => {
    const result = await client.callTool('memory_graph', {})
    assertUpgradeResponse(result, 'memory_graph')
  }, 15000)

  it('detect_duplicates returns upgrade message on free tier', async () => {
    const result = await client.callTool('detect_duplicates', {})
    assertUpgradeResponse(result, 'detect_duplicates')
  }, 15000)

  it('impact_analysis returns upgrade message on free tier', async () => {
    const result = await client.callTool('impact_analysis', { key: 'some-memory-key' })
    assertUpgradeResponse(result, 'impact_analysis')
  }, 15000)

  it('archive_memory returns upgrade message on free tier', async () => {
    const result = await client.callTool('archive_memory', { key: 'some-memory-key' })
    assertUpgradeResponse(result, 'archive_memory')
  }, 15000)

  it('session_replay returns upgrade message on free tier', async () => {
    const result = await client.callTool('session_replay', { sessionId: 'fake-session-id' })
    assertUpgradeResponse(result, 'session_replay')
  }, 15000)

  it('all 8 pro tools do not throw when called on free tier', async () => {
    const proToolCalls: Array<[string, Record<string, unknown>]> = [
      ['memory_stats_detail', {}],
      ['contextual_recall', { query: 'anything' }],
      ['resolve_conflict', { conflictId: 'x', strategy: 'keep_newer' }],
      ['memory_graph', {}],
      ['detect_duplicates', {}],
      ['impact_analysis', { key: 'x' }],
      ['archive_memory', { key: 'x' }],
      ['session_replay', { sessionId: 'x' }],
    ]

    for (const [toolName, args] of proToolCalls) {
      await expect(client.callTool(toolName, args)).resolves.toBeDefined()
    }
  }, 60000)
})
