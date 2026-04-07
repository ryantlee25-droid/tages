import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpTestClient } from './mcp-client'
import * as os from 'os'
import * as path from 'path'

describe('McpTestClient sanity', () => {
  let client: McpTestClient
  const dbPath = path.join(os.tmpdir(), `tages-t1-sanity-${Date.now()}.db`)

  beforeAll(async () => {
    client = new McpTestClient(dbPath)
    await client.start()
  }, 30000)

  afterAll(async () => {
    await client.stop()
  })

  it('calls stats and returns content', async () => {
    const result = await client.callTool('stats', {})
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toBeTruthy()
  }, 15000)
})
