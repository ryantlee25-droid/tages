import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface ArchiveOptions {
  project?: string
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

export async function archiveListCommand(options: ArchiveOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Archive requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data: memories } = await supabase
    .from('memories')
    .select('key, value, updated_at, type')
    .eq('project_id', config.projectId)
    .eq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(20)

  if (!memories?.length) {
    console.log(chalk.dim('No archived memories.'))
    return
  }

  console.log(chalk.bold(`Archived memories (${memories.length}):\n`))
  for (const mem of memories as Array<{ key: string; value: string; updated_at: string; type: string }>) {
    console.log(`  ${chalk.dim('[' + mem.type + ']')} ${chalk.bold(mem.key)}`)
    console.log(`  ${chalk.dim(mem.value.slice(0, 60))} — archived ${mem.updated_at.slice(0, 10)}`)
    console.log()
  }
  console.log(chalk.dim('Use the MCP restore_memory tool to restore an archived memory.'))
}

export async function archiveStatsCommand(options: ArchiveOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Archive stats requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
  const { count: liveCount } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', config.projectId)
    .eq('status', 'live')

  const { count: archivedCount } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', config.projectId)
    .eq('status', 'archived')

  console.log(chalk.bold('Archive Statistics:\n'))
  console.log(`  Live memories:     ${chalk.green(String(liveCount ?? 0))}`)
  console.log(`  Archived memories: ${chalk.yellow(String(archivedCount ?? 0))}`)
  console.log(`  Archive rate:      ${liveCount ? ((archivedCount ?? 0) / ((liveCount ?? 0) + (archivedCount ?? 0)) * 100).toFixed(1) : 0}%`)
}
