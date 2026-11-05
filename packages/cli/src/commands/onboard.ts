import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClientWithStatus, requireLiveSession } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

/** Types that get their own section in the briefing; the rest go under OTHER. */
const RENDERED_TYPES = new Set([
  'architecture', 'convention', 'decision', 'lesson', 'entity', 'pattern', 'anti_pattern',
])

interface OnboardOptions {
  project?: string
}

export async function onboardCommand(options: OnboardOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Onboard requires cloud connection.'))
    process.exit(1)
  }

  const spinner = ora('Loading project knowledge...').start()
  const { supabase, status } = await createAuthenticatedClientWithStatus(
    config.supabaseUrl,
    config.supabaseAnonKey,
  )
  requireLiveSession(status, 'build a briefing', () => spinner.stop())

  const { data: memories } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', config.projectId)
    // Live only: pending rows are unreviewed and archived rows are retired;
    // neither belongs in a teammate's briefing.
    .eq('status', 'live')
    .order('type')
    .order('confidence', { ascending: false })

  if (!memories || memories.length === 0) {
    spinner.info('No memories stored yet. Use `tages remember` or `tages index` to build project knowledge.')
    return
  }

  spinner.stop()

  // Group by type
  const grouped: Record<string, typeof memories> = {}
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }

  const teal = (s: string) => chalk.hex('#3BA3C7')(s)

  console.log()
  console.log(teal('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(teal(`  PROJECT BRIEFING: ${config.slug}`))
  console.log(teal('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log()
  console.log(chalk.dim(`  ${memories.length} memories across ${Object.keys(grouped).length} categories`))
  console.log()

  // Architecture first — the big picture
  if (grouped.architecture) {
    console.log(chalk.bold.white('  ARCHITECTURE'))
    console.log(chalk.dim('  How this project is structured:\n'))
    for (const m of grouped.architecture) {
      console.log(`    ${chalk.green('▸')} ${chalk.bold(m.key)}`)
      console.log(`      ${chalk.dim(m.value)}`)
      if (m.file_paths?.length) {
        console.log(`      ${chalk.dim('Files: ' + m.file_paths.join(', '))}`)
      }
      console.log()
    }
  }

  // Conventions — how to write code here
  if (grouped.convention) {
    console.log(chalk.bold.white('  CONVENTIONS'))
    console.log(chalk.dim('  Rules to follow when writing code:\n'))
    for (const m of grouped.convention) {
      console.log(`    ${chalk.blue('▸')} ${chalk.bold(m.key)}`)
      console.log(`      ${chalk.dim(m.value)}`)
      console.log()
    }
  }

  // Decisions — why things are the way they are
  if (grouped.decision) {
    console.log(chalk.bold.white('  DECISIONS'))
    console.log(chalk.dim('  Why things were built this way:\n'))
    for (const m of grouped.decision) {
      console.log(`    ${chalk.magenta('▸')} ${chalk.bold(m.key)}`)
      console.log(`      ${chalk.dim(m.value)}`)
      console.log()
    }
  }

  // Lessons — things to watch out for
  if (grouped.lesson) {
    console.log(chalk.bold.white('  LESSONS & GOTCHAS'))
    console.log(chalk.dim('  Things that bit us before:\n'))
    for (const m of grouped.lesson) {
      console.log(`    ${chalk.yellow('▸')} ${chalk.bold(m.key)}`)
      console.log(`      ${chalk.dim(m.value)}`)
      console.log()
    }
  }

  // Entities
  if (grouped.entity) {
    console.log(chalk.bold.white('  KEY ENTITIES'))
    for (const m of grouped.entity) {
      console.log(`    ${chalk.cyan('▸')} ${chalk.bold(m.key)}: ${chalk.dim(m.value)}`)
    }
    console.log()
  }

  // Patterns
  if (grouped.pattern) {
    console.log(chalk.bold.white('  PATTERNS'))
    for (const m of grouped.pattern) {
      console.log(`    ${chalk.white('▸')} ${chalk.bold(m.key)}: ${chalk.dim(m.value)}`)
    }
    console.log()
  }

  // Anti-patterns: the Don't / Never rules
  if (grouped.anti_pattern) {
    console.log(chalk.bold.white("  ANTI-PATTERNS (DON'T / NEVER)"))
    console.log(chalk.dim('  Things not to do here:\n'))
    for (const m of grouped.anti_pattern) {
      console.log(`    ${chalk.red('▸')} ${chalk.bold(m.key)}`)
      console.log(`      ${chalk.dim(m.value)}`)
      console.log()
    }
  }

  // Every other live type (preference, execution, operational, environment,
  // anything added later) so no live memory is invisible in the briefing.
  const otherTypes = Object.keys(grouped).filter(t => !RENDERED_TYPES.has(t)).sort()
  if (otherTypes.length > 0) {
    console.log(chalk.bold.white('  OTHER'))
    for (const t of otherTypes) {
      for (const m of grouped[t]) {
        console.log(`    ${chalk.white('▸')} ${chalk.bold(m.key)} ${chalk.dim(`(${t})`)}: ${chalk.dim(m.value)}`)
      }
    }
    console.log()
  }

  console.log(teal('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'))
  console.log(chalk.dim(`  Run ${chalk.white('tages recall "<question>"')} to search for specific knowledge.`))
  console.log()
}

