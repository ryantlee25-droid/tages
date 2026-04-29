#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { argv, cwd, exit, stderr, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'

const USAGE = `
tages-cursor-plugin — install Tages as an MCP server in Cursor

Usage:
  npx @tages/cursor-plugin [options]

Options:
  --project          Write to ./.cursor/mcp.json in current directory (default)
  --global           Write to ~/.cursor/mcp.json
  --dry-run          Print the config block to stdout instead of writing
  --print            Alias for --dry-run
  --force            Overwrite an existing "tages" entry
  -h, --help         Show this message

Examples:
  npx @tages/cursor-plugin
  npx @tages/cursor-plugin --global
  npx @tages/cursor-plugin --dry-run
`.trim()

interface Args {
  scope: 'project' | 'global'
  dryRun: boolean
  force: boolean
  help: boolean
}

function parseArgs(raw: string[]): Args {
  const args: Args = { scope: 'project', dryRun: false, force: false, help: false }
  for (const a of raw) {
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--global') args.scope = 'global'
    else if (a === '--project') args.scope = 'project'
    else if (a === '--dry-run' || a === '--print') args.dryRun = true
    else if (a === '--force') args.force = true
    else {
      stderr.write(`Unknown argument: ${a}\n${USAGE}\n`)
      exit(2)
    }
  }
  return args
}

function resolveConfigPath(scope: 'project' | 'global'): string {
  if (scope === 'global') {
    const home = process.env.HOME || process.env.USERPROFILE
    if (!home) {
      stderr.write('Cannot locate home directory for --global scope.\n')
      exit(1)
      throw new Error('unreachable')
    }
    return join(home, '.cursor', 'mcp.json')
  }
  return resolve(cwd(), '.cursor', 'mcp.json')
}

interface McpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface CursorMcpFile {
  mcpServers?: Record<string, McpServerEntry>
  [key: string]: unknown
}

export function buildTagesEntry(): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', '@tages/server'],
    env: {
      // Users fill these in after install. Empty strings are valid placeholders;
      // Tages server falls back to local-only mode when cloud env vars are absent.
      TAGES_SUPABASE_URL: '',
      TAGES_SUPABASE_ANON_KEY: '',
      TAGES_PROJECT_ID: '',
    },
  }
}

function loadExisting(path: string): CursorMcpFile {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CursorMcpFile
  } catch (error) {
    stderr.write(`Failed to parse existing ${path}: ${(error as Error).message}\n`)
    exit(1)
  }
}

function main(): void {
  const args = parseArgs(argv.slice(2))
  if (args.help) {
    stdout.write(`${USAGE}\n`)
    return
  }

  const tagesEntry = buildTagesEntry()

  if (args.dryRun) {
    const snippet: CursorMcpFile = { mcpServers: { tages: tagesEntry } }
    stdout.write(`${JSON.stringify(snippet, null, 2)}\n`)
    return
  }

  const path = resolveConfigPath(args.scope)
  const existing = loadExisting(path)
  const servers = existing.mcpServers ?? {}

  if (servers.tages && !args.force) {
    stderr.write(
      `A "tages" MCP server is already configured in ${path}. Use --force to overwrite.\n`,
    )
    exit(1)
  }

  servers.tages = tagesEntry
  const next: CursorMcpFile = { ...existing, mcpServers: servers }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  stdout.write(`Wrote Tages MCP server config to ${path}\n`)
  stdout.write(
    '\nNext steps:\n' +
      '  1. Edit the env values (TAGES_SUPABASE_URL, TAGES_SUPABASE_ANON_KEY, TAGES_PROJECT_ID).\n' +
      '  2. Restart Cursor.\n' +
      '  3. Open the MCP tools panel; Tages tools should appear under "tages".\n',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
