import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir, getAuthPath } from '../config/paths.js'

interface PatternsOptions {
  project?: string
}

export async function patternsDetectCommand(options: PatternsOptions) {
  const config = loadProjectConfig(options.project)
  const auth = loadAuth()
  if (!config || !auth) {
    console.error(chalk.red('Not configured. Run `tages init` first.'))
    process.exit(1)
  }

  const spinner = ora('Detecting shared patterns across projects...').start()
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data, error } = await supabase.rpc('detect_shared_patterns', {
    p_user_id: auth.userId,
  })

  if (error) {
    spinner.fail(`Detection failed: ${error.message}`)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    spinner.info('No shared patterns found across projects (need 2+ projects with matching memory keys).')
    return
  }

  spinner.succeed(`Found ${data.length} patterns shared across projects:`)
  console.log()

  for (const p of data) {
    console.log(`  ${chalk.bold(p.key)} (${p.type})`)
    console.log(`    ${chalk.dim(p.value.slice(0, 100))}${p.value.length > 100 ? '...' : ''}`)
    console.log(`    ${chalk.dim('Used in:')} ${(p.projects as string[]).join(', ')} (${p.project_count} projects)`)
    console.log()
  }
}

export async function patternsPromoteCommand(key: string, options: PatternsOptions) {
  const config = loadProjectConfig(options.project)
  const auth = loadAuth()
  if (!config || !auth) {
    console.error(chalk.red('Not configured. Run `tages init` first.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  // Find the memory by key
  const { data: mem } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', config.projectId)
    .eq('key', key)
    .single()

  if (!mem) {
    console.error(chalk.red(`Memory "${key}" not found.`))
    process.exit(1)
  }

  const { error } = await supabase.rpc('promote_to_library', {
    p_user_id: auth.userId,
    p_key: mem.key,
    p_value: mem.value,
    p_type: mem.type,
    p_source_project: config.slug || 'unknown',
  })

  if (error) {
    console.error(chalk.red(`Promote failed: ${error.message}`))
    process.exit(1)
  }

  console.log(chalk.green(`  Promoted "${key}" to your pattern library.`))
}

export async function patternsListCommand(options: PatternsOptions) {
  const config = loadProjectConfig(options.project)
  const auth = loadAuth()
  if (!config || !auth) {
    console.error(chalk.red('Not configured. Run `tages init` first.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data } = await supabase
    .from('pattern_library')
    .select('*')
    .eq('owner_id', auth.userId)
    .order('usage_count', { ascending: false })

  if (!data || data.length === 0) {
    console.log(chalk.dim('  No patterns in your library. Use `tages patterns promote <key>` to add one.'))
    return
  }

  console.log(chalk.bold(`\n  Pattern Library (${data.length} patterns)\n`))
  for (const p of data) {
    const projects = (p.source_projects as string[])?.join(', ') || ''
    console.log(`  ${chalk.bold(p.key)} (${p.type}) — used in ${p.usage_count} projects`)
    console.log(`    ${chalk.dim(p.value.slice(0, 100))}`)
    if (projects) console.log(`    ${chalk.dim('Projects: ' + projects)}`)
    console.log()
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
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}

function loadAuth() {
  const authPath = getAuthPath()
  if (!fs.existsSync(authPath)) return null
  return JSON.parse(fs.readFileSync(authPath, 'utf-8'))
}
