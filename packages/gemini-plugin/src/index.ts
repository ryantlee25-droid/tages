#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { pathToFileURL } from 'node:url'

const USAGE = `
tages-gemini-plugin — install Tages as an MCP server in Gemini CLI

Usage:
  npx @tages/gemini-plugin [options]

Options:
  --dry-run          Print the config block to stdout instead of writing
  --print            Alias for --dry-run
  --force            Overwrite an existing "tages" entry
  -h, --help         Show this message

Examples:
  npx @tages/gemini-plugin
  npx @tages/gemini-plugin --dry-run
  npx @tages/gemini-plugin --force
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

function resolveSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) {
    stderr.write('Cannot locate home directory.\n')
    exit(1)
    throw new Error('unreachable')
  }
  return join(home, '.gemini', 'settings.json')
}

interface McpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface GeminiSettings {
  mcpServers?: Record<string, McpServerEntry>
  [key: string]: unknown
}

export function buildTagesEntry(): McpServerEntry {
  return {
    command: 'npx',
    args: ['-y', '@tages/server'],
    env: {
      TAGES_SUPABASE_URL: '',
      TAGES_SUPABASE_ANON_KEY: '',
      TAGES_PROJECT_ID: '',
    },
  }
}

function loadExisting(path: string): GeminiSettings {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GeminiSettings
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
    const snippet: GeminiSettings = { mcpServers: { tages: tagesEntry } }
    stdout.write(`${JSON.stringify(snippet, null, 2)}\n`)
    return
  }

  const settingsPath = resolveSettingsPath()
  const existing = loadExisting(settingsPath)
  const servers = existing.mcpServers ?? {}

  if (servers['tages'] && !args.force) {
    stderr.write(
      `A "tages" MCP server is already configured in ${settingsPath}. Use --force to overwrite.\n`,
    )
    exit(1)
  }

  servers['tages'] = tagesEntry

  // Preserve all existing top-level keys; update only mcpServers
  const next: GeminiSettings = { ...existing, mcpServers: servers }

  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

  stdout.write(`Wrote Tages MCP server config to ${settingsPath}\n`)
  stdout.write(
    '\nNext steps:\n' +
      '  1. Edit the env values (TAGES_SUPABASE_URL, TAGES_SUPABASE_ANON_KEY, TAGES_PROJECT_ID).\n' +
      '  2. Restart Gemini CLI (or any tool that reads ~/.gemini/settings.json).\n' +
      '  3. The Tages MCP tools will appear under "tages" in the MCP tools panel.\n',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
