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
 * Returns the path to the Claude Code MCP settings file based on platform.
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
