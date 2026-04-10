import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCachePath, getProjectsDir } from '../config/paths.js'

interface StatusOptions {
  project?: string
}

/**
 * Detect which project this directory maps to (mirrors server detection logic).
 */
function detectProject(cwd: string): { slug: string; method: string } | null {
  // 1. .tages/config.json marker
  try {
    const markerPath = path.join(cwd, '.tages', 'config.json')
    if (fs.existsSync(markerPath)) {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      if (marker.slug) return { slug: marker.slug, method: 'marker (.tages/config.json)' }
    }
  } catch { /* fall through */ }

  // 2. Git remote
  try {
    const remote = execSync('git remote get-url origin', { cwd, timeout: 300, stdio: 'pipe', encoding: 'utf-8' }).trim()
    const repoName = remote.replace(/\.git$/, '').split('/').pop()
    if (repoName) {
      const configPath = path.join(getProjectsDir(), `${repoName}.json`)
      if (fs.existsSync(configPath)) return { slug: repoName, method: 'git remote' }
    }
  } catch { /* fall through */ }

  // 3. Directory name
  const dirName = path.basename(cwd)
  const dirConfigPath = path.join(getProjectsDir(), `${dirName}.json`)
  if (fs.existsSync(dirConfigPath)) return { slug: dirName, method: 'directory name' }

  return null
}

export async function statusCommand(options: StatusOptions) {
  let config = loadProjectConfig(options.project)
  let detectedVia = options.project ? 'explicit slug' : 'config lookup'

  // If no explicit project, try auto-detection
  if (!config && !options.project) {
    const detected = detectProject(process.cwd())
    if (detected) {
      config = loadProjectConfig(detected.slug)
      detectedVia = detected.method
    }
  }

  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` or `tages link <slug>`.'))
    process.exit(1)
  }

  console.log(chalk.bold('\n  Tages Status\n'))
  console.log(`  ${chalk.dim('Project:')}  ${config.slug}`)
  console.log(`  ${chalk.dim('Mode:')}     ${config.supabaseUrl ? 'Cloud' : 'Local-only'}`)
  console.log(`  ${chalk.dim('Detected:')} ${detectedVia}`)

  // Cache info
  const cachePath = getCachePath(config.slug)
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath)
    const sizeKb = (stats.size / 1024).toFixed(1)
    console.log(`  ${chalk.dim('Cache:')}    ${cachePath} (${sizeKb} KB)`)
  } else {
    console.log(`  ${chalk.dim('Cache:')}    not initialized`)
  }

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

    // Memory counts by type
    const { data, error } = await supabase
      .from('memories')
      .select('type')
      .eq('project_id', config.projectId)

    if (error) {
      console.log(`  ${chalk.dim('Memories:')} ${chalk.red('failed to fetch')}`)
    } else if (data) {
      const counts: Record<string, number> = {}
      for (const row of data) {
        counts[row.type] = (counts[row.type] || 0) + 1
      }

      const total = data.length
      const limit = 10000
      const pct = Math.round((total / limit) * 100)
      console.log(`  ${chalk.dim('Memories:')} ${total} / ${limit.toLocaleString()} (${pct}%)`)
      for (const [type, count] of Object.entries(counts).sort()) {
        console.log(`             ${type}: ${count}`)
      }
    }
  } else {
    console.log(`  ${chalk.dim('Sync:')}     ${chalk.yellow('Cloud sync unavailable. Local mode active.')}`)
    console.log(`  ${chalk.dim('          Memories are stored locally.')}`)
  }

  console.log()
}

