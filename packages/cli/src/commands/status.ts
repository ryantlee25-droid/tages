import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir, getCachePath } from '../config/paths.js'

interface StatusOptions {
  project?: string
}

export async function statusCommand(options: StatusOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  console.log(chalk.bold('\n  Tages Status\n'))
  console.log(`  ${chalk.dim('Project:')}  ${config.slug}`)
  console.log(`  ${chalk.dim('Mode:')}     ${config.supabaseUrl ? 'Cloud' : 'Local-only'}`)

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
    const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

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

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
