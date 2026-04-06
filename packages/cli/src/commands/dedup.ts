import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

interface DedupOptions {
  project?: string
  threshold?: string
}

export async function dedupCommand(options: DedupOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const threshold = options.threshold ? parseFloat(options.threshold) : 0.7

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.yellow('Dedup requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Fetch all live memories
  const { data: memories, error } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', config.projectId)
    .eq('status', 'live')

  if (error || !memories) {
    console.error(chalk.red(`Failed to fetch memories: ${error?.message}`))
    process.exit(1)
  }

  console.log(chalk.bold(`Scanning ${memories.length} memories for duplicates (threshold: ${(threshold * 100).toFixed(0)}%)...\n`))

  // Simple Jaccard similarity scan
  type MemRow = { key: string; value: string; type: string }
  function tokenSet(text: string): Set<string> {
    return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2))
  }

  const pairs: Array<{ a: MemRow; b: MemRow; score: number }> = []
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i] as MemRow
      const b = memories[j] as MemRow
      if (a.type !== b.type) continue
      const tokA = tokenSet(`${a.key} ${a.value}`)
      const tokB = tokenSet(`${b.key} ${b.value}`)
      const intersection = [...tokA].filter(t => tokB.has(t))
      const union = new Set([...tokA, ...tokB])
      const score = union.size > 0 ? intersection.length / union.size : 0
      if (score >= threshold) {
        pairs.push({ a, b, score })
      }
    }
  }

  if (pairs.length === 0) {
    console.log(chalk.green('No duplicate memories found.'))
    return
  }

  console.log(chalk.bold(`Found ${pairs.length} potential duplicate pair(s):\n`))

  for (const pair of pairs) {
    console.log(chalk.yellow(`Score: ${(pair.score * 100).toFixed(0)}%`) + chalk.dim(` [${pair.a.type}]`))
    console.log(`  A: ${chalk.bold(pair.a.key)}: ${chalk.dim(pair.a.value.slice(0, 70))}`)
    console.log(`  B: ${chalk.bold(pair.b.key)}: ${chalk.dim(pair.b.value.slice(0, 70))}`)
    console.log()
  }

  console.log(chalk.dim('Use the MCP consolidate_memories tool to merge pairs interactively.'))
}
