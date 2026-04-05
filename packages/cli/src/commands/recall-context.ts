import * as fs from 'fs'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface RecallContextOptions {
  agent?: string
  phase?: string
  project?: string
  limit?: string
}

function getChangedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const all = [...output.split('\n'), ...staged.split('\n')]
      .map((f) => f.trim())
      .filter(Boolean)
    return [...new Set(all)]
  } catch {
    return []
  }
}

function getCurrentBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}

export async function recallContextCommand(query: string, options: RecallContextOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const changedFiles = getChangedFiles()
  const branch = getCurrentBranch()
  const limit = options.limit ? parseInt(options.limit, 10) : 5

  console.log(chalk.dim(`Context: ${changedFiles.length} changed files${branch ? `, branch: ${branch}` : ''}`))

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.yellow('No Supabase config — contextual recall requires cloud connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data, error } = await supabase.rpc('contextual_recall', {
    p_project_id: config.projectId,
    p_query: query,
    p_conditions: changedFiles.length > 0 ? changedFiles : null,
    p_agent_name: options.agent || null,
    p_phase: options.phase || null,
    p_type: null,
    p_limit: limit,
  })

  if (error) {
    console.error(chalk.red(`Contextual recall failed: ${error.message}`))
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.log(chalk.dim(`No contextual memories found for "${query}".`))
    return
  }

  console.log(chalk.bold(`Found ${data.length} contextual memories`) + chalk.dim(` for "${query}":\n`))

  for (const row of data as Record<string, unknown>[]) {
    const typeColor = getTypeColor(row.type as string)
    console.log(`  ${typeColor((row.type as string).padEnd(12))} ${chalk.bold(row.key as string)}`)
    console.log(`  ${chalk.dim('             ')}${row.value}`)
    if (Array.isArray(row.conditions) && row.conditions.length > 0) {
      console.log(`  ${chalk.dim('             ')}${chalk.dim(`When: ${(row.conditions as string[]).join('; ')}`)}`)
    }
    console.log()
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
    execution: chalk.red,
  }
  return colors[type] || chalk.white
}
