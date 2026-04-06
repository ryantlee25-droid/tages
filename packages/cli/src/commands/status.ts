import * as fs from 'fs'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCachePath } from '../config/paths.js'

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

