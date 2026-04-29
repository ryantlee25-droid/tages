import { describe, expect, it } from 'vitest'
import { buildTagesBlock, hasTagesBlock, stripTagesBlock } from '../index.js'

describe('codex-plugin / buildTagesBlock', () => {
  it('emits a parseable [mcp_servers.tages] header followed by the env table', () => {
    const block = buildTagesBlock()
    expect(block).toContain('[mcp_servers.tages]')
    expect(block).toContain('command = "npx"')
    expect(block).toContain('[mcp_servers.tages.env]')
    expect(block).toContain('TAGES_SUPABASE_URL = ""')
  })
})

describe('codex-plugin / hasTagesBlock', () => {
  it('detects the tages table header', () => {
    expect(hasTagesBlock('[mcp_servers.tages]\ncommand = "npx"')).toBe(true)
  })

  it('returns false for empty content', () => {
    expect(hasTagesBlock('')).toBe(false)
  })

  it('returns false when only an unrelated mcp server is configured', () => {
    expect(hasTagesBlock('[mcp_servers.other]\ncommand = "x"')).toBe(false)
  })
})

describe('codex-plugin / stripTagesBlock (regression: --force must not duplicate headers)', () => {
  it('removes the [mcp_servers.tages] table and its key/value lines', () => {
    const input =
      '[mcp_servers.tages]\n' +
      'command = "npx"\n' +
      'args = ["-y", "@tages/server"]\n'
    const out = stripTagesBlock(input)
    expect(out).not.toContain('[mcp_servers.tages]')
    expect(out).not.toContain('command = "npx"')
  })

  it('removes the [mcp_servers.tages.env] table as well', () => {
    const input =
      '[mcp_servers.tages]\n' +
      'command = "npx"\n' +
      '\n' +
      '[mcp_servers.tages.env]\n' +
      'TAGES_SUPABASE_URL = "x"\n'
    const out = stripTagesBlock(input)
    expect(out).not.toContain('[mcp_servers.tages.env]')
    expect(out).not.toContain('TAGES_SUPABASE_URL')
  })

  it('preserves other [mcp_servers.X] tables', () => {
    const input =
      '[mcp_servers.other]\n' +
      'command = "thing"\n' +
      '\n' +
      '[mcp_servers.tages]\n' +
      'command = "npx"\n' +
      '\n' +
      '[mcp_servers.tages.env]\n' +
      'TAGES_PROJECT_ID = "abc"\n' +
      '\n' +
      '[mcp_servers.also]\n' +
      'command = "y"\n'
    const out = stripTagesBlock(input)
    expect(out).toContain('[mcp_servers.other]')
    expect(out).toContain('command = "thing"')
    expect(out).toContain('[mcp_servers.also]')
    expect(out).toContain('command = "y"')
    expect(out).not.toContain('[mcp_servers.tages]')
    expect(out).not.toContain('[mcp_servers.tages.env]')
  })

  it('round-trip: stripping then appending a fresh block leaves exactly one [mcp_servers.tages] header', () => {
    const original =
      '[mcp_servers.tages]\n' +
      'command = "old"\n' +
      '\n' +
      '[mcp_servers.tages.env]\n' +
      'TAGES_SUPABASE_URL = "old-url"\n'
    const next = `${stripTagesBlock(original)}\n${buildTagesBlock()}\n`
    const headerCount = next.match(/^\[mcp_servers\.tages\]\s*$/gm)?.length ?? 0
    const envHeaderCount = next.match(/^\[mcp_servers\.tages\.env\]\s*$/gm)?.length ?? 0
    expect(headerCount).toBe(1)
    expect(envHeaderCount).toBe(1)
    expect(next).not.toContain('command = "old"')
  })

  it('handles content with no tages block as a no-op', () => {
    const input = '[mcp_servers.other]\ncommand = "x"\n'
    expect(stripTagesBlock(input)).toContain('[mcp_servers.other]')
  })

  it('also strips the array-of-tables form [[mcp_servers.tages]]', () => {
    const input =
      '[mcp_servers.other]\n' +
      'command = "x"\n' +
      '\n' +
      '[[mcp_servers.tages]]\n' +
      'command = "old"\n'
    const out = stripTagesBlock(input)
    expect(out).toContain('[mcp_servers.other]')
    expect(out).not.toContain('[[mcp_servers.tages]]')
    expect(out).not.toContain('command = "old"')
  })
})
