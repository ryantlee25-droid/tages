import { describe, expect, it } from 'vitest'
import { buildTagesEntry } from '../index.js'

describe('gemini-plugin / buildTagesEntry', () => {
  it('returns a Gemini-compatible MCP server entry', () => {
    const entry = buildTagesEntry()
    expect(entry.command).toBe('npx')
    expect(entry.args).toEqual(['-y', '@tages/server'])
    expect(entry.env).toBeDefined()
  })

  it('includes the three Tages env-var placeholders', () => {
    const entry = buildTagesEntry()
    expect(entry.env).toMatchObject({
      TAGES_SUPABASE_URL: '',
      TAGES_SUPABASE_ANON_KEY: '',
      TAGES_PROJECT_ID: '',
    })
  })

  it('produces an entry that JSON-serialises cleanly into a Gemini settings block', () => {
    const entry = buildTagesEntry()
    const file = { mcpServers: { tages: entry } }
    const round = JSON.parse(JSON.stringify(file))
    expect(round.mcpServers.tages.command).toBe('npx')
    expect(round.mcpServers.tages.args).toEqual(['-y', '@tages/server'])
  })
})
