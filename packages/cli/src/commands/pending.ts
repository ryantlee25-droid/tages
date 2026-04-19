import chalk from 'chalk'
import ora from 'ora'
import * as readline from 'readline'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

interface PendingOptions {
  project?: string
  approveAll?: boolean
  rejectAll?: boolean
  minConfidence?: string
  session?: string
  yes?: boolean
  stats?: boolean
}

interface PendingMemory {
  id: string
  key: string
  type: string
  confidence: number
  created_at: string
  tags: string[]
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

  const minConfidence = options.minConfidence !== undefined
    ? parseFloat(options.minConfidence)
    : undefined

  if (minConfidence !== undefined && (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1)) {
    console.error(chalk.red('--min-confidence must be a number between 0 and 1 (e.g. 0.8)'))
    process.exit(1)
  }

  const spinner = ora('Loading pending memories...').start()
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: memories, error } = await supabase
    .from('memories')
    .select('id, key, type, confidence, created_at, tags')
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

  // Apply filters
  let filtered: PendingMemory[] = memories as PendingMemory[]

  if (minConfidence !== undefined) {
    filtered = filtered.filter(m => (m.confidence ?? 1) >= minConfidence)
  }

  if (options.session) {
    const sessionId = options.session
    filtered = filtered.filter(m => {
      const tags: string[] = Array.isArray(m.tags) ? m.tags : []
      return tags.some(t => t === `session-extract:${sessionId}` || t === sessionId)
    })
  }

  // --stats mode
  if (options.stats) {
    printStats(memories as PendingMemory[])
    return
  }

  // --approve-all mode
  if (options.approveAll) {
    await bulkApprove(filtered, supabase, options.yes)
    return
  }

  // --reject-all mode
  if (options.rejectAll) {
    await bulkReject(filtered, supabase, options.yes)
    return
  }

  // Default list output
  console.log(chalk.bold(`\n  ${memories.length} pending ${memories.length === 1 ? 'memory' : 'memories'}:\n`))

  const toDisplay = filtered.length < (memories as PendingMemory[]).length ? filtered : (memories as PendingMemory[])

  for (const m of toDisplay) {
    const typeColor = getTypeColor(m.type)
    const confidence = Math.round((m.confidence ?? 1) * 100)
    const date = new Date(m.created_at).toLocaleDateString()
    const conf = m.confidence ?? 1
    const confBadge = conf >= 0.8
      ? chalk.green(`${confidence}%`)
      : conf >= 0.5
        ? chalk.yellow(`${confidence}%`)
        : chalk.red(`${confidence}%`)
    console.log(
      `  ${typeColor((m.type as string).padEnd(12))} ${chalk.bold(m.key)}`,
    )
    console.log(
      `  ${' '.repeat(13)}${chalk.dim('confidence: ')}${confBadge}${chalk.dim(`  added: ${date}`)}`,
    )
    console.log()
  }

  if (filtered.length < (memories as PendingMemory[]).length) {
    console.log(chalk.dim(`  (Showing ${filtered.length} of ${memories.length} pending memories)\n`))
  }

  console.log(chalk.dim(`  Run ${chalk.white('tages verify <key>')} to promote a memory to live.`))
  console.log(chalk.dim(`  Run ${chalk.white('tages pending --reject <key>')} to discard one.\n`))
  console.log(chalk.dim(`  Tip: approve all at once with: ${chalk.white('tages pending --approve-all')}`))
  console.log(chalk.dim(`  Or by confidence: ${chalk.white('tages pending --approve-all --min-confidence 0.8')}\n`))
}

function printStats(memories: PendingMemory[]) {
  const total = memories.length
  const high = memories.filter(m => (m.confidence ?? 1) >= 0.8).length
  const medium = memories.filter(m => {
    const c = m.confidence ?? 1
    return c >= 0.5 && c < 0.8
  }).length
  const low = memories.filter(m => (m.confidence ?? 1) < 0.5).length

  console.log(chalk.bold('\n  Pending Memory Stats\n'))
  console.log(`  ${chalk.dim('Total pending:')} ${total}`)
  console.log(`    ${chalk.green(`high confidence (>=0.8):`)} ${high}`)
  console.log(`    ${chalk.yellow(`medium (0.5-0.8):`)}       ${medium}`)
  console.log(`    ${chalk.red(`low (<0.5):`)}               ${low}`)

  // Group by session tag
  const sessionMap: Record<string, number> = {}
  for (const m of memories) {
    const tags: string[] = Array.isArray(m.tags) ? m.tags : []
    const sessionTag = tags.find(t => t.startsWith('session-extract:') || t === 'session-extract')
    const sessionKey = sessionTag ?? '(no session)'
    sessionMap[sessionKey] = (sessionMap[sessionKey] || 0) + 1
  }

  if (Object.keys(sessionMap).length > 0) {
    const sessionParts = Object.entries(sessionMap)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${s} (${n})`)
      .join(', ')
    console.log(`  ${chalk.dim('By session:')} ${sessionParts}`)
  }

  console.log()
}

async function promptUser(message: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close()
      resolve(answer)
    })
  })
}

async function bulkApprove(
  memories: PendingMemory[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  skipConfirm?: boolean,
) {
  if (memories.length === 0) {
    console.log(chalk.dim('No pending memories match the filter.'))
    return
  }

  if (!skipConfirm) {
    const answer = await promptUser(
      chalk.yellow(`Approve all ${memories.length} pending ${memories.length === 1 ? 'memory' : 'memories'}? [y/N] `),
    )
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(chalk.dim('Aborted.'))
      return
    }
  }

  const spinner = ora(`Approving ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}...`).start()

  const ids = memories.map(m => m.id)
  const { error } = await supabase
    .from('memories')
    .update({
      status: 'live',
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) {
    spinner.fail(`Failed to approve memories: ${error.message}`)
    process.exit(1)
  }

  spinner.succeed(chalk.green(`Approved ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} — now live and available in recall.`))
}

async function bulkReject(
  memories: PendingMemory[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  skipConfirm?: boolean,
) {
  if (memories.length === 0) {
    console.log(chalk.dim('No pending memories match the filter.'))
    return
  }

  if (!skipConfirm) {
    const answer = await promptUser(
      chalk.red(`Archive all ${memories.length} pending ${memories.length === 1 ? 'memory' : 'memories'}? They'll be hidden but recoverable. [y/N] `),
    )
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log(chalk.dim('Aborted.'))
      return
    }
  }

  const spinner = ora(`Archiving ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}...`).start()

  const ids = memories.map(m => m.id)
  const { error } = await supabase
    .from('memories')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) {
    spinner.fail(`Failed to archive memories: ${error.message}`)
    process.exit(1)
  }

  spinner.succeed(chalk.dim(`Archived ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}.`))
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
    operational: chalk.yellowBright,
    environment: chalk.blueBright,
  }
  return colors[type] || chalk.white
}
