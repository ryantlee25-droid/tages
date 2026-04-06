import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import type { Memory } from '@tages/shared'

interface QualityOptions {
  project?: string
}

function scoreMemory(mem: Memory): number {
  let score = 0
  if (mem.conditions?.length) score += 5
  if (mem.examples?.length) score += 5
  if (mem.crossSystemRefs?.length) score += 5
  if (mem.tags?.length) score += 5
  if (mem.filePaths?.length) score += 5
  const ageDays = (Date.now() - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  score += Math.max(0, Math.round(25 * (1 - Math.min(ageDays / 180, 1))))
  score += 25  // consistency default
  score += Math.round(mem.confidence * 15) + Math.min(Math.round(mem.value.length / 20), 10)
  return Math.min(score, 100)
}

export async function qualityCommand(keyOrOptions: string | QualityOptions, options?: QualityOptions) {
  const key = typeof keyOrOptions === 'string' ? keyOrOptions : undefined
  const opts = typeof keyOrOptions === 'object' ? keyOrOptions : (options || {})

  const config = loadProjectConfig(opts.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Quality scoring requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  if (key) {
    // Score single memory
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

    const score = scoreMemory(mem as Memory)
    const grade = score >= 80 ? chalk.green('Excellent') : score >= 60 ? chalk.cyan('Good') : score >= 40 ? chalk.yellow('Fair') : chalk.red('Poor')
    console.log(`Quality for "${chalk.bold(key)}": ${chalk.bold(score.toString())}/100 ${grade}`)
    console.log(`  Conditions: ${(mem as Memory).conditions?.length ? chalk.green('Y') : chalk.red('N')}`)
    console.log(`  Examples:   ${(mem as Memory).examples?.length ? chalk.green('Y') : chalk.red('N')}`)
    console.log(`  Cross-refs: ${(mem as Memory).crossSystemRefs?.length ? chalk.green('Y') : chalk.red('N')}`)
    console.log(`  Tags:       ${(mem as Memory).tags?.length ? chalk.green('Y') : chalk.red('N')}`)
  } else {
    // Project health
    const { data: memories } = await supabase
      .from('memories')
      .select('*')
      .eq('project_id', config.projectId)
      .eq('status', 'live')

    if (!memories?.length) {
      console.log(chalk.dim('No live memories found.'))
      return
    }

    const scores = (memories as Memory[]).map(m => scoreMemory(m))
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    const grade = avg >= 80 ? chalk.green('Excellent') : avg >= 60 ? chalk.cyan('Good') : avg >= 40 ? chalk.yellow('Fair') : chalk.red('Poor')

    console.log(chalk.bold('Project Health Score: ') + chalk.bold(avg.toString()) + '/100 ' + grade)
    console.log(`  ${memories.length} live memories`)

    const dist = { excellent: 0, good: 0, fair: 0, poor: 0 }
    for (const s of scores) {
      if (s >= 80) dist.excellent++
      else if (s >= 60) dist.good++
      else if (s >= 40) dist.fair++
      else dist.poor++
    }
    console.log(`  Excellent: ${dist.excellent}  Good: ${dist.good}  Fair: ${dist.fair}  Poor: ${dist.poor}`)
  }
}
