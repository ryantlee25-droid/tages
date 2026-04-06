import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

interface EnforceOptions {
  project?: string
}

export async function enforceCommand(options: EnforceOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  console.log(chalk.bold('Convention Enforcement Report\n'))
  console.log(chalk.dim('Use the MCP enforcement_report tool for full per-agent compliance stats.'))
  console.log(chalk.dim('Use tages enforce check <key> to check a specific memory.'))
}

export async function enforceCheckCommand(key: string, options: EnforceOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Enforcement check requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Get the memory to check
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

  // Get all conventions
  const { data: conventions } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', config.projectId)
    .eq('type', 'convention')
    .eq('status', 'live')

  const positiveMarkers = ['always', 'must', 'should', 'required', 'use']
  const negativeMarkers = ['never', 'avoid', 'must not', 'do not', 'dont']
  let violation = null

  for (const conv of (conventions || []) as Array<{ key: string; value: string; id: string }>) {
    if (conv.id === mem.id) continue
    const aLower = conv.value.toLowerCase()
    const bLower = mem.value.toLowerCase()
    const aPos = positiveMarkers.some(m => aLower.includes(m))
    const aNeg = negativeMarkers.some(m => aLower.includes(m))
    const bPos = positiveMarkers.some(m => bLower.includes(m))
    const bNeg = negativeMarkers.some(m => bLower.includes(m))
    if ((aPos && bNeg) || (aNeg && bPos)) {
      const tokA = new Set(aLower.split(/\s+/).filter((t: string) => t.length > 2))
      const tokB = new Set(bLower.split(/\s+/).filter((t: string) => t.length > 2))
      const overlap = [...tokA].filter(t => tokB.has(t)).length / Math.max(tokA.size, tokB.size, 1)
      if (overlap > 0.3) {
        violation = conv
        break
      }
    }
  }

  if (violation) {
    console.log(chalk.red(`VIOLATION: "${key}" conflicts with convention "${violation.key}"`))
    console.log(chalk.dim(`  Convention: ${violation.value.slice(0, 80)}`))
    console.log(chalk.dim(`  Candidate:  ${mem.value.slice(0, 80)}`))
  } else {
    console.log(chalk.green(`COMPLIANT: "${key}" has no convention conflicts.`))
  }
}
