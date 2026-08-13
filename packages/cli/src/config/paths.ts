import * as path from 'path'
import * as os from 'os'

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'tages')
}

export function getAuthPath(): string {
  return path.join(getConfigDir(), 'auth.json')
}

export function getProjectsDir(): string {
  return path.join(getConfigDir(), 'projects')
}

export function getProjectConfigPath(slug: string): string {
  return path.join(getProjectsDir(), `${slug}.json`)
}

export function getCacheDir(): string {
  return path.join(getConfigDir(), 'cache')
}

export function getCachePath(slug: string): string {
  return path.join(getCacheDir(), `${slug}.db`)
}

/**
 * Returns the path to the project-scoped MCP config file that Claude Code reads.
 *
 * Claude Code does NOT read `claude_desktop_config.json`. It discovers MCP
 * servers from a `.mcp.json` at the root of the project it is launched in
 * (project scope), or from `~/.claude.json` (user scope, nested per project).
 * We target `.mcp.json` because it is the documented, flat, per-project
 * convention — `~/.claude.json`'s nested-by-project schema is unverified here.
 *
 * Resolved against `process.cwd()`, so `tages init` configures the repo it is
 * run in. Callers must `chdir` (or run) inside the target project.
 *
 * The written file carries the project id and Supabase anon key in `env`, so
 * `injectMcpConfig` also adds it to the repo's local git excludes.
 */
export function getClaudeCodeMcpConfigPath(): string {
  return path.join(process.cwd(), '.mcp.json')
}

/**
 * Returns the path to **Claude Desktop's** MCP settings file for this platform.
 *
 * This is Claude Desktop's config, not Claude Code's — an earlier version of
 * this docblock claimed otherwise and that is why `tages init` reported success
 * while Claude Code saw no server. For Claude Code use
 * {@link getClaudeCodeMcpConfigPath}. Kept exported for Claude Desktop users
 * and for `tages doctor`, which probes both locations.
 */
export function getClaudeDesktopConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    case 'win32':
      return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
    default:
      return path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json')
  }
}
