import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { createSupabaseClient, createCloudProject, createLocalProject } from '@tages/shared'
import type { ProjectConfig } from '@tages/shared'

export type { ProjectConfig }

export type DetectionMethod = 'marker' | 'git-remote' | 'dirname' | 'auto-create' | 'env' | 'fallback'

export interface ResolvedProject {
  config: ProjectConfig
  detectionMethod: DetectionMethod
}

export interface ServerConfig {
  project: ProjectConfig
  cachePath: string
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'tages')
}

export function getProjectConfigPath(slug: string): string {
  return path.join(getConfigDir(), 'projects', `${slug}.json`)
}

export function getCachePath(slug: string): string {
  const dir = path.join(getConfigDir(), 'cache')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, `${slug}.db`)
}

export function loadProjectConfig(slug?: string): ProjectConfig | null {
  // If slug provided, load that specific project
  if (slug) {
    const configPath = getProjectConfigPath(slug)
    if (!fs.existsSync(configPath)) return null
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return { ...config, plan: config.plan || 'free' }
  }

  // Otherwise, try to detect from current directory or env
  const envUrl = process.env.SUPABASE_URL || process.env.TAGES_SUPABASE_URL
  const envKey = process.env.SUPABASE_ANON_KEY || process.env.TAGES_SUPABASE_ANON_KEY
  const envProjectId = process.env.TAGES_PROJECT_ID

  if (envUrl && envKey && envProjectId) {
    return {
      projectId: envProjectId,
      slug: process.env.TAGES_PROJECT_SLUG || 'default',
      supabaseUrl: envUrl,
      supabaseAnonKey: envKey,
      plan: (process.env.TAGES_PLAN as 'free' | 'pro' | 'team') || 'free',
    }
  }

  // Try to find a project config in the config dir
  const projectsDir = path.join(getConfigDir(), 'projects')
  if (!fs.existsSync(projectsDir)) return null

  const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null

  // Use the first (or only) project
  const config = JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf-8'))
  return { ...config, plan: config.plan || 'free' }
}

export function loadServerConfig(slug?: string): ServerConfig | null {
  const project = loadProjectConfig(slug)
  if (!project) return null

  return {
    project,
    cachePath: getCachePath(project.slug),
  }
}

/**
 * List all registered project configs from ~/.config/tages/projects/
 */
function listRegisteredProjects(): ProjectConfig[] {
  const projectsDir = path.join(getConfigDir(), 'projects')
  if (!fs.existsSync(projectsDir)) return []

  return fs.readdirSync(projectsDir)
    .filter(f => f.endsWith('.json') && !f.endsWith('.bak'))
    .map(f => {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf-8'))
        return { ...config, plan: config.plan || 'free' } as ProjectConfig
      } catch {
        return null
      }
    })
    .filter((c): c is ProjectConfig => c !== null)
}

/**
 * Extract owner/repo from a git remote URL.
 * Handles SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
 */
function extractRepoName(remoteUrl: string): string | null {
  const cleaned = remoteUrl.trim().replace(/\.git$/, '')
  // SSH: git@github.com:owner/repo
  const sshMatch = cleaned.match(/[:/]([^/]+\/[^/]+)$/)
  if (sshMatch) {
    const parts = sshMatch[1].split('/')
    return parts[parts.length - 1] || null
  }
  // HTTPS: https://github.com/owner/repo
  const parts = cleaned.split('/')
  return parts[parts.length - 1] || null
}

/**
 * Load auth credentials from ~/.config/tages/auth.json
 */
function loadAuth(): { accessToken: string; refreshToken: string; userId: string } | null {
  try {
    const authPath = path.join(getConfigDir(), 'auth.json')
    if (!fs.existsSync(authPath)) return null
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    if (auth.accessToken && auth.refreshToken && auth.userId) return auth
    return null
  } catch {
    return null
  }
}

/**
 * Normalize a directory name into a valid project slug.
 */
function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unnamed'
}

const DEFAULT_SUPABASE_URL = 'https://wezagdgpvwfywjoxztfs.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlemFnZGdwdndmeXdqb3h6dGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcyNTAsImV4cCI6MjA5MDkyMzI1MH0.iMJ3gnt0w104QxzEaTLJsAYVciPDFJvAzOtIU5tofG0'

/**
 * Resolve the active project from the working directory.
 *
 * Detection chain (first match wins):
 * 1. .tages/config.json marker in cwd
 * 2. Git remote URL matches a registered project slug
 * 3. Directory name matches a registered project slug
 * 4. Auto-create: cloud if authenticated, local-only otherwise
 */
export async function resolveProject(cwd: string): Promise<ResolvedProject> {
  const registered = listRegisteredProjects()

  // Strategy 1: .tages/config.json marker file
  try {
    const markerPath = path.join(cwd, '.tages', 'config.json')
    if (fs.existsSync(markerPath)) {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      if (marker.slug) {
        const match = registered.find(p => p.slug === marker.slug)
        if (match) {
          console.error(`[tages] Detected project '${match.slug}' via .tages/config.json`)
          return { config: match, detectionMethod: 'marker' }
        }
      }
    }
  } catch {
    // Marker unreadable — fall through
  }

  // Strategy 2: Git remote URL match
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd,
      timeout: 300,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim()

    const repoName = extractRepoName(remoteUrl)
    if (repoName) {
      const match = registered.find(p => p.slug === repoName)
      if (match) {
        console.error(`[tages] Detected project '${match.slug}' via git remote`)
        return { config: match, detectionMethod: 'git-remote' }
      }
    }
  } catch {
    // Git not available, not a repo, no remote, or timeout — fall through
  }

  // Strategy 3: Directory name match
  const dirName = sanitizeSlug(path.basename(cwd))
  const dirMatch = registered.find(p => p.slug === dirName)
  if (dirMatch) {
    console.error(`[tages] Detected project '${dirMatch.slug}' via directory name`)
    return { config: dirMatch, detectionMethod: 'dirname' }
  }

  // Strategy 4: Auto-create
  const auth = loadAuth()
  if (auth) {
    // Authenticated — try to create a cloud project
    try {
      const supabaseUrl = process.env.TAGES_SUPABASE_URL || DEFAULT_SUPABASE_URL
      const supabaseAnonKey = process.env.TAGES_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
      const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)
      await supabase.auth.setSession({
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
      })

      const config = await createCloudProject(dirName, auth.userId, supabase, supabaseUrl, supabaseAnonKey)

      // Save the project config for future detection
      const projectsDir = path.join(getConfigDir(), 'projects')
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true })
      const configPath = path.join(projectsDir, `${dirName}.json`)
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })

      console.error(`[tages] Auto-created cloud project '${dirName}'`)
      return { config, detectionMethod: 'auto-create' }
    } catch (err) {
      // Tier limit or other error — fall back to local
      console.error(`[tages] Cloud auto-create failed (${(err as Error).message}) — using local mode`)
    }
  }

  // Fallback: local-only project
  const config = createLocalProject(dirName)

  // Save for future detection
  const projectsDir = path.join(getConfigDir(), 'projects')
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true })
  const configPath = path.join(projectsDir, `${dirName}.json`)
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  }

  console.error(`[tages] No matching project found — using local mode for '${dirName}'`)
  return { config, detectionMethod: 'auto-create' }
}
