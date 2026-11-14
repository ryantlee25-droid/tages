import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import chalk from 'chalk'
import { getClaudeCodeMcpConfigPath } from './paths.js'

interface McpConfig {
  mcpServers?: Record<string, {
    command: string
    args?: string[]
    env?: Record<string, string>
  }>
  [key: string]: unknown
}

/** Default server invocation: the published npm package via npx. */
const DEFAULT_SERVER_COMMAND = 'npx'
const DEFAULT_SERVER_ARGS = ['-y', '@tages/server']

/** The line we add to the repo's local git excludes. */
const EXCLUDE_ENTRY = '.mcp.json'

export interface InjectMcpConfigOptions {
  supabaseUrl?: string
  supabaseAnonKey?: string
  projectId?: string
  projectSlug?: string
  /**
   * Executable used to launch the tages MCP server. Defaults to `npx`.
   * Pass e.g. `'node'` to run a locally built server instead of the published
   * package (the published `@tages/server` may lag this repo).
   */
  serverCommand?: string
  /**
   * Args for `serverCommand`. Defaults to `['-y', '@tages/server']` when
   * `serverCommand` is also omitted; defaults to `[]` when a custom
   * `serverCommand` is given, so the npx args are never grafted onto it.
   */
  serverArgs?: string[]
}

export interface InjectMcpConfigResult {
  /** Absolute path to the `.mcp.json` that was written. */
  path: string
  /** True when the file did not previously exist. */
  created: boolean
  /** True when `.mcp.json` is now listed in the repo's local git excludes. */
  excluded: boolean
  /** Absolute path to `info/exclude`, when one was resolved. */
  excludePath?: string
}

/**
 * Merges the tages MCP server entry into the project-scoped `.mcp.json` that
 * Claude Code reads, without destroying existing entries.
 *
 * Any `mcpServers` already in the file (a teammate's other servers) are
 * preserved; only the `tages` key is replaced. Top-level keys are preserved too.
 *
 * Because the written file embeds the project id and Supabase anon key, the
 * file is also appended to the repo's local `.git/info/exclude` (never a shared
 * `.gitignore`, which tages does not own). A non-git directory is skipped
 * silently; a git repo whose excludes cannot be written prints a warning so the
 * credential-bearing file is never left silently untracked-but-committable.
 */
export function injectMcpConfig(opts?: InjectMcpConfigOptions): InjectMcpConfigResult {
  const configPath = getClaudeCodeMcpConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let config: McpConfig = {}
  let created = false

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8')
    try {
      config = JSON.parse(raw)
      if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('expected a JSON object at the top level')
      }
    } catch (err) {
      // Refuse to clobber a file we cannot parse — that would be data loss.
      throw new Error(
        `Could not parse existing MCP config at ${configPath}: ${(err as Error).message}\n` +
        `Fix or remove the file, then re-run.`
      )
    }
  } else {
    created = true
  }

  if (!config.mcpServers) {
    config.mcpServers = {}
  }

  const env: Record<string, string> = {}
  if (opts?.supabaseUrl) env.TAGES_SUPABASE_URL = opts.supabaseUrl
  if (opts?.supabaseAnonKey) env.TAGES_SUPABASE_ANON_KEY = opts.supabaseAnonKey
  if (opts?.projectId) env.TAGES_PROJECT_ID = opts.projectId
  if (opts?.projectSlug) env.TAGES_PROJECT_SLUG = opts.projectSlug

  const command = opts?.serverCommand ?? DEFAULT_SERVER_COMMAND
  const args = opts?.serverArgs ?? (opts?.serverCommand ? [] : DEFAULT_SERVER_ARGS)

  config.mcpServers.tages = {
    command,
    args: [...args],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

  const exclusion = ensureLocallyExcluded(configPath)
  return { path: configPath, created, excluded: exclusion.excluded, excludePath: exclusion.excludePath }
}

/** Thrown when an existing `.mcp.json` cannot be parsed as a JSON object. */
export class McpConfigParseError extends Error {
  constructor(public readonly configPath: string, public readonly reason: string) {
    super(`Could not parse ${configPath}: ${reason}`)
    this.name = 'McpConfigParseError'
  }
}

/**
 * Throws `McpConfigParseError` when the project-scoped `.mcp.json` exists but
 * is not a parsable JSON object. A missing file is fine (it will be created).
 *
 * `link` and `init` call this BEFORE writing anything (project config, dir
 * marker, git hook, cloud project), so an unparsable file stops the command
 * up front instead of leaving a half-finished setup behind.
 */
export function assertMcpConfigParsable(): void {
  const configPath = getClaudeCodeMcpConfigPath()
  if (!fs.existsSync(configPath)) return
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch (err) {
    throw new McpConfigParseError(configPath, (err as Error).message)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new McpConfigParseError(configPath, 'expected a JSON object at the top level')
  }
}

/**
 * CLI wrapper around `assertMcpConfigParsable`: prints a clear message naming
 * the file and exits 1 (no stack trace). The file is never modified.
 */
export function requireParsableMcpConfig(command: string): void {
  try {
    assertMcpConfigParsable()
  } catch (err) {
    if (err instanceof McpConfigParseError) {
      console.error(chalk.red(`  Could not parse ${err.configPath}: ${err.reason}.`))
      console.error(chalk.dim(`  Fix or remove the file, then re-run \`tages ${command}\`. Nothing was changed.`))
      process.exit(1)
    }
    throw err
  }
}

/**
 * Reads the current project-scoped MCP config and returns it if it exists.
 */
export function readMcpConfig(): McpConfig | null {
  const configPath = getClaudeCodeMcpConfigPath()
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
}

/**
 * Adds `.mcp.json` to the containing repo's local git excludes.
 *
 * `.git/info/exclude` is per-clone and never committed, so this ignores the
 * credential-bearing file for this user without touching a shared `.gitignore`.
 * Uses `git rev-parse --git-path` so linked worktrees resolve correctly.
 */
function ensureLocallyExcluded(configPath: string): { excluded: boolean; excludePath?: string } {
  const cwd = path.dirname(configPath)

  let excludePath: string
  try {
    const raw = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!raw) return { excluded: false }
    excludePath = path.resolve(cwd, raw)
  } catch {
    // Not a git repo, or git is unavailable — nothing to exclude from.
    return { excluded: false }
  }

  try {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true })

    let contents = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : ''
    const alreadyListed = contents
      .split('\n')
      .some((line) => {
        const t = line.trim()
        return t === EXCLUDE_ENTRY || t === `/${EXCLUDE_ENTRY}`
      })

    if (alreadyListed) {
      return { excluded: true, excludePath }
    }

    if (contents.length > 0 && !contents.endsWith('\n')) contents += '\n'
    contents += `${EXCLUDE_ENTRY}\n`
    fs.writeFileSync(excludePath, contents)

    console.log(chalk.dim(`  Added ${EXCLUDE_ENTRY} to ${excludePath} (it holds project credentials — keep it out of git)`))
    return { excluded: true, excludePath }
  } catch (err) {
    console.warn(chalk.yellow(
      `  Warning: could not update ${excludePath} (${(err as Error).message}).\n` +
      `  Add ${EXCLUDE_ENTRY} to your gitignore — it contains your project id and Supabase key.`
    ))
    return { excluded: false, excludePath }
  }
}
