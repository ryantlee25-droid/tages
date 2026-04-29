#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'

const USAGE = `
tages-codex-plugin — install Tages as an MCP server in OpenAI Codex

Usage:
  npx @tages/codex-plugin [options]

Options:
  --dry-run          Print the config block to stdout instead of writing
  --print            Alias for --dry-run
  --force            Replace an existing "[mcp_servers.tages]" block in-place
  -h, --help         Show this message

Examples:
  npx @tages/codex-plugin
  npx @tages/codex-plugin --dry-run

Alternative (uses Codex's built-in MCP installer):
  codex mcp add tages -- npx -y @tages/server
`.trim()

interface Args {
  dryRun: boolean
  force: boolean
  help: boolean
}

function parseArgs(raw: string[]): Args {
  const args: Args = { dryRun: false, force: false, help: false }
  for (const a of raw) {
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--dry-run' || a === '--print') args.dryRun = true
    else if (a === '--force') args.force = true
    else {
      stderr.write(`Unknown argument: ${a}\n${USAGE}\n`)
      exit(2)
    }
  }
  return args
}

function resolveConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) {
    stderr.write('Cannot locate home directory.\n')
    exit(1)
    throw new Error('unreachable')
  }
  return join(home, '.codex', 'config.toml')
}

export function buildTagesBlock(): string {
  return [
    '[mcp_servers.tages]',
    'command = "npx"',
    'args = ["-y", "@tages/server"]',
    '',
    '[mcp_servers.tages.env]',
    'TAGES_SUPABASE_URL = ""',
    'TAGES_SUPABASE_ANON_KEY = ""',
    'TAGES_PROJECT_ID = ""',
  ].join('\n')
}

export function hasTagesBlock(existing: string): boolean {
  return /^\[mcp_servers\.tages\]/m.test(existing)
}

/**
 * Remove the [mcp_servers.tages] and [mcp_servers.tages.env] tables (and their
 * key/value lines) from a TOML document, leaving all other content intact.
 *
 * Walks line by line: when a target table header is hit, skip all lines until
 * the next table header (any `[...]`) or EOF. This preserves the user's other
 * config without depending on a TOML parser.
 */
export function stripTagesBlock(content: string): string {
  const targetHeader = /^\[mcp_servers\.tages(?:\.[a-zA-Z0-9_-]+)*\]\s*$/
  const anyHeader = /^\[[^\]]+\]\s*$/
  const out: string[] = []
  const lines = content.split('\n')
  let skipping = false
  for (const line of lines) {
    if (targetHeader.test(line)) {
      skipping = true
      continue
    }
    if (skipping && anyHeader.test(line)) {
      skipping = false
    }
    if (!skipping) out.push(line)
  }
  // Collapse any run of 3+ blank lines left behind from the strip
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

function main(): void {
  const args = parseArgs(argv.slice(2))
  if (args.help) {
    stdout.write(`${USAGE}\n`)
    return
  }

  const block = buildTagesBlock()

  if (args.dryRun) {
    stdout.write(`${block}\n`)
    return
  }

  const path = resolveConfigPath()
  const rawExisting = existsSync(path) ? readFileSync(path, 'utf8') : ''

  if (hasTagesBlock(rawExisting) && !args.force) {
    stderr.write(
      `A "[mcp_servers.tages]" block already exists in ${path}.\n` +
        `Use --force to replace it in-place, or edit the file manually.\n` +
        `Safer alternative: codex mcp add tages -- npx -y @tages/server\n`,
    )
    exit(1)
  }

  // When --force is set on an existing config, remove the old tages tables
  // before appending the new block; otherwise duplicate [mcp_servers.tages]
  // headers would make the TOML unparseable.
  const existing = hasTagesBlock(rawExisting) ? stripTagesBlock(rawExisting) : rawExisting

  const separator = existing.length === 0 || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  const next = `${existing}${separator}${block}\n`

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next, 'utf8')

  stdout.write(`Wrote Tages MCP server config to ${path}\n`)
  stdout.write(
    '\nNext steps:\n' +
      '  1. Edit the env values (TAGES_SUPABASE_URL, TAGES_SUPABASE_ANON_KEY, TAGES_PROJECT_ID).\n' +
      '  2. Restart Codex.\n' +
      '  3. Ask Codex to use a Tages tool (e.g. "recall what we decided about auth").\n',
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
