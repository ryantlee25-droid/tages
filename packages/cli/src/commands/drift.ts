/**
 * tages drift — Agent Stability Index (experimental).
 *
 * Computes semantic / coordination / behavioral drift across a project's
 * memory history. v1 reports real semantic drift only; coordination and
 * behavioral are stubbed with explicit status notes.
 */
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import type { DriftReport, FieldChangeRow, ToolCallRow } from '../../../server/src/drift/index.js'

async function loadDriftModule() {
  // @ts-ignore
  const mod = await import('../../../server/src/drift/index.js')
  return mod as {
    computeDrift: (input: {
      projectId: string
      since?: string
      agentFilter?: string
      fieldChanges: FieldChangeRow[]
      toolCalls: ToolCallRow[]
    }) => DriftReport
  }
}

export interface DriftOptions {
  project?: string
  since?: string // e.g. '7d', '30d', or ISO timestamp
  agent?: string
  json?: boolean
  limit?: string
}

export async function driftCommand(options: DriftOptions): Promise<void> {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('drift requires cloud connection.'))
    process.exit(1)
  }

  const sinceIso = resolveSince(options.since)
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // 1. field_changes for value-column writes in window
  let fcQuery = supabase
    .from('field_changes')
    .select('memory_id, project_id, field_name, old_value, new_value, change_type, created_at')
    .eq('project_id', config.projectId)
    .eq('field_name', 'value')
    .order('created_at', { ascending: true })

  if (sinceIso) fcQuery = fcQuery.gte('created_at', sinceIso)

  const { data: fcData, error: fcError } = await fcQuery
  if (fcError) {
    console.error(chalk.red(`Failed to load field_changes: ${fcError.message}`))
    process.exit(1)
  }

  // 2. memories (for key + session_id + agent_name join)
  const memoryIds = [...new Set((fcData ?? []).map((r) => r.memory_id as string))]
  const memoryIndex = new Map<
    string,
    { key: string; session_id: string | null; agent_name: string | null }
  >()
  if (memoryIds.length > 0) {
    const { data: memData, error: memError } = await supabase
      .from('memories')
      .select('id, key, session_id, agent_name')
      .in('id', memoryIds)
    if (memError) {
      console.error(chalk.red(`Failed to load memories: ${memError.message}`))
      process.exit(1)
    }
    for (const m of memData ?? []) {
      memoryIndex.set(m.id as string, {
        key: (m.key as string) ?? '',
        session_id: (m.session_id as string | null) ?? null,
        agent_name: (m.agent_name as string | null) ?? null,
      })
    }
  }

  const fieldChanges: FieldChangeRow[] = (fcData ?? [])
    .map((r) => {
      const m = memoryIndex.get(r.memory_id as string)
      return {
        memory_id: r.memory_id as string,
        memory_key: m?.key ?? null,
        project_id: r.project_id as string,
        field_name: r.field_name as string,
        old_value: r.old_value,
        new_value: r.new_value,
        change_type: r.change_type as FieldChangeRow['change_type'],
        created_at: r.created_at as string,
        session_id: m?.session_id ?? null,
        agent_name: m?.agent_name ?? null,
      }
    })
    .filter((r) => !options.agent || r.agent_name === options.agent)

  // 3. tool_call_log for behavioral metric (stub consumes but v1 only checks agent count)
  let tcQuery = supabase
    .from('tool_call_log')
    .select('project_id, session_id, agent_name, tool_name, created_at')
    .eq('project_id', config.projectId)
  if (sinceIso) tcQuery = tcQuery.gte('created_at', sinceIso)
  if (options.agent) tcQuery = tcQuery.eq('agent_name', options.agent)

  const { data: tcData, error: tcError } = await tcQuery
  // tool_call_log might be empty / RLS-denied on older projects — treat absence as zero, not error
  const toolCalls: ToolCallRow[] = tcError
    ? []
    : ((tcData ?? []) as ToolCallRow[])

  const { computeDrift } = await loadDriftModule()
  const report = computeDrift({
    projectId: config.projectId,
    since: sinceIso,
    agentFilter: options.agent,
    fieldChanges,
    toolCalls,
  })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  renderHuman(report, Number(options.limit ?? '10'))
}

export function resolveSince(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = /^(\d+)([dh])$/.exec(raw)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    const msPerUnit = unit === 'd' ? 86400_000 : 3600_000
    return new Date(Date.now() - n * msPerUnit).toISOString()
  }
  // Try parsing as ISO
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return d.toISOString()
  throw new Error(`Unrecognized --since value: ${raw}. Use Nd, Nh, or ISO timestamp.`)
}

function renderHuman(report: DriftReport, topLimit: number): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  console.log(
    chalk.bold('Tages drift report ') +
      chalk.yellow('[experimental]') +
      chalk.dim(` — project ${report.projectId}`),
  )
  if (report.window.since) console.log(chalk.dim(`  window: since ${report.window.since}`))
  if (report.agentFilter) console.log(chalk.dim(`  agent filter: ${report.agentFilter}`))
  console.log('')
  console.log(`Overall drift score: ${chalk.bold(pct(report.driftScore))}`)
  console.log(chalk.dim(`  weights: semantic=${report.weights.semantic} coordination=${report.weights.coordination} behavioral=${report.weights.behavioral}`))
  console.log('')
  console.log(chalk.bold('Semantic drift'))
  console.log(`  score: ${pct(report.semantic.score)}`)
  console.log(`  keys examined: ${report.semantic.keysExamined}`)
  console.log(`  keys with drift: ${report.semantic.keysWithDrift}`)
  if (report.semantic.topKeys.length > 0) {
    console.log(chalk.dim(`  top ${Math.min(topLimit, report.semantic.topKeys.length)} diverging keys:`))
    for (const k of report.semantic.topKeys.slice(0, topLimit)) {
      console.log(
        `    ${k.memoryKey.padEnd(40)} distinct=${k.distinctValues} changes=${k.totalChanges} instability=${pct(k.instability)}`,
      )
      if (k.sessions.length > 1 || k.agents.length > 1) {
        console.log(chalk.dim(`      sessions: ${k.sessions.length}  agents: ${k.agents.join(', ')}`))
      }
    }
  }
  console.log('')
  console.log(chalk.bold('Coordination drift') + chalk.yellow(` [${report.coordination.status}]`))
  console.log(chalk.dim(`  ${report.coordination.note}`))
  console.log('')
  console.log(chalk.bold('Behavioral drift') + chalk.yellow(` [${report.behavioral.status}]`))
  console.log(chalk.dim(`  ${report.behavioral.note}`))
}
