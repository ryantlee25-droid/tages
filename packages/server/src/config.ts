import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface ProjectConfig {
  projectId: string
  slug: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export interface ServerConfig {
  project: ProjectConfig
  cachePath: string
}

function getConfigDir(): string {
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
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
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
    }
  }

  // Try to find a project config in the config dir
  const projectsDir = path.join(getConfigDir(), 'projects')
  if (!fs.existsSync(projectsDir)) return null

  const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null

  // Use the first (or only) project
  return JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf-8'))
}

export function loadServerConfig(slug?: string): ServerConfig | null {
  const project = loadProjectConfig(slug)
  if (!project) return null

  return {
    project,
    cachePath: getCachePath(project.slug),
  }
}
