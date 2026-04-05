import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface RecallOptions {
  type?: string
  limit?: string
  project?: string
}

export async function recallCommand(query: string, options: RecallOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 5

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
    const { data, error } = await supabase.rpc('recall_memories', {
      p_project_id: config.projectId,
      p_query: query,
      p_type: options.type || null,
      p_limit: limit,
    })

    if (error) {
      console.error(chalk.red(`Recall failed: ${error.message}`))
      process.exit(1)
    }

    if (!data || data.length === 0) {
      console.log(chalk.dim(`No memories found matching "${query}".`))
      return
    }

    console.log(chalk.bold(`Found ${data.length} memories:\n`))
    for (const row of data) {
      const typeColor = getTypeColor(row.type)
      console.log(`  ${typeColor(row.type.padEnd(12))} ${chalk.bold(row.key)}`)
      console.log(`  ${chalk.dim('             ')}${row.value}`)
      if (row.similarity) {
        console.log(`  ${chalk.dim('             ')}${chalk.dim(`similarity: ${(row.similarity as number).toFixed(2)}`)}`)
      }
      console.log()
    }
  } else {
    console.error(chalk.yellow('No Supabase config — recall requires cloud connection.'))
    console.log(chalk.dim('Run `tages init` to configure cloud sync.'))
  }
}

function getTypeColor(type: string) {
  const colors: Record<string, (s: string) => string> = {
    convention: chalk.blue,
    decision: chalk.magenta,
    architecture: chalk.green,
    entity: chalk.yellow,
    lesson: chalk.cyan,
    preference: chalk.gray,
    pattern: chalk.white,
  }
  return colors[type] || chalk.white
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
