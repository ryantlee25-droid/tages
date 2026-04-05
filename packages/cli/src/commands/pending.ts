import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface PendingOptions {
  project?: string
}

export async function pendingCommand(options: PendingOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('pending requires cloud connection.'))
    process.exit(1)
  }

  const spinner = ora('Loading pending memories...').start()
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: memories, error } = await supabase
    .from('memories')
    .select('id, key, type, confidence, created_at')
    .eq('project_id', config.projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  spinner.stop()

  if (error) {
    console.error(chalk.red(`Failed to load pending memories: ${error.message}`))
    process.exit(1)
  }

  if (!memories || memories.length === 0) {
    console.log(chalk.dim('No memories pending review.'))
    return
  }

  console.log(chalk.bold(`\n  ${memories.length} pending ${memories.length === 1 ? 'memory' : 'memories'}:\n`))

  for (const m of memories) {
    const typeColor = getTypeColor(m.type)
    const confidence = Math.round((m.confidence ?? 1) * 100)
    const date = new Date(m.created_at).toLocaleDateString()
    console.log(
      `  ${typeColor((m.type as string).padEnd(12))} ${chalk.bold(m.key)}`,
    )
    console.log(
      `  ${' '.repeat(13)}${chalk.dim(`confidence: ${confidence}%  added: ${date}`)}`,
    )
    console.log()
  }

  console.log(chalk.dim(`  Run ${chalk.white('tages verify <key>')} to promote a memory to live.\n`))
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
    execution: chalk.red,
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
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
