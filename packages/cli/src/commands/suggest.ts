import * as fs from 'fs'
import chalk from 'chalk'
import { getProjectsDir } from '../config/paths.js'
import { createSupabaseClient } from '@tages/shared'

interface SuggestOptions {
  project?: string
  limit?: string
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

export async function suggestCommand(options: SuggestOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 10

  // Suggestions work from local miss log in the MCP server context.
  // In CLI mode, we provide generic advice based on memory distribution.
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.yellow('No Supabase config — suggestions require cloud connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  // Get memory type distribution to suggest under-covered types
  const { data: memories } = await supabase
    .from('memories')
    .select('type')
    .eq('project_id', config.projectId)
    .eq('status', 'live')

  if (!memories || memories.length === 0) {
    console.log(chalk.dim('No memories yet — start by running `tages remember` or the MCP server.'))
    return
  }

  const typeCounts: Record<string, number> = {}
  for (const m of memories) {
    typeCounts[m.type] = (typeCounts[m.type] || 0) + 1
  }

  const allTypes = ['convention', 'decision', 'architecture', 'entity', 'lesson', 'pattern', 'execution']
  const missing = allTypes.filter((t) => !typeCounts[t])
  const sparse = allTypes.filter((t) => typeCounts[t] > 0 && typeCounts[t] < 3)

  console.log(chalk.bold('Memory Suggestions\n'))
  console.log(chalk.dim(`Total memories: ${memories.length}`))
  console.log()

  let rank = 1

  if (missing.length > 0) {
    console.log(chalk.yellow('Not yet covered:'))
    for (const type of missing.slice(0, limit)) {
      const hint = getTypeHint(type)
      console.log(`  ${rank++}. Store ${chalk.bold(type)} memories — ${hint}`)
    }
    console.log()
  }

  if (sparse.length > 0) {
    console.log(chalk.dim('Sparse (< 3 entries):'))
    for (const type of sparse.slice(0, limit)) {
      console.log(`  ${rank++}. Add more ${chalk.bold(type)} memories (currently ${typeCounts[type]})`)
    }
    console.log()
  }

  if (missing.length === 0 && sparse.length === 0) {
    console.log(chalk.green('Good coverage across all memory types!'))
    console.log(chalk.dim('Run recall queries during development — missed queries generate targeted suggestions via the MCP server.'))
  }
}

function getTypeHint(type: string): string {
  const hints: Record<string, string> = {
    convention: 'coding style rules, naming conventions, patterns to follow',
    decision: 'architectural decisions, why things were built this way',
    architecture: 'module boundaries, system design, data flow',
    entity: 'key domain objects, their relationships and invariants',
    lesson: 'lessons learned, what not to do, past mistakes',
    pattern: 'reusable patterns, templates, approaches that work well',
    execution: 'step-by-step workflows, deployment processes, runbooks',
  }
  return hints[type] || 'undocumented area'
}
