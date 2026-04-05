import * as fs from 'fs'
import * as path from 'path'
import { getClaudeDesktopConfigPath } from './paths.js'

interface McpConfig {
  mcpServers?: Record<string, {
    command: string
    args?: string[]
    env?: Record<string, string>
  }>
  [key: string]: unknown
}

/**
 * Merges the tages MCP server entry into Claude Code's desktop config
 * without destroying existing entries.
 */
export function injectMcpConfig(opts?: {
  supabaseUrl?: string
  supabaseAnonKey?: string
  projectId?: string
  projectSlug?: string
}): { path: string; created: boolean } {
  const configPath = getClaudeDesktopConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  let config: McpConfig = {}
  let created = false

  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
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

  config.mcpServers.tages = {
    command: 'npx',
    args: ['-y', '@tages/server'],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  return { path: configPath, created }
}

/**
 * Reads the current MCP config and returns the tages entry if it exists.
 */
export function readMcpConfig(): McpConfig | null {
  const configPath = getClaudeDesktopConfigPath()
  if (!fs.existsSync(configPath)) return null
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
}
