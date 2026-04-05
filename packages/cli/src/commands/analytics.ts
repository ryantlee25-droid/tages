import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface AnalyticsOptions {
  project?: string
  agent?: string
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
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}

export async function analyticsSummaryCommand(options: AnalyticsOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Analytics requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: sessions } = await supabase
    .from('agent_sessions')
    .select('*')
    .eq('project_id', config.projectId)
    .order('created_at', { ascending: false })
    .limit(parseInt(options.limit || '10'))

  if (!sessions?.length) {
    console.log(chalk.dim('No agent sessions found.'))
    return
  }

  console.log(chalk.bold(`Agent Sessions (${sessions.length}):\n`))
  for (const s of sessions as Array<{ id: string; agent_name: string | null; created_at: string; ended_at: string | null }>) {
    const duration = s.ended_at
      ? ((new Date(s.ended_at).getTime() - new Date(s.created_at).getTime()) / 1000).toFixed(0) + 's'
      : 'active'
    console.log(`  ${chalk.dim(s.id.slice(0, 8))} ${chalk.bold(s.agent_name || 'unknown')} — ${s.created_at.slice(0, 16)} (${duration})`)
  }

  console.log('\n' + chalk.dim('Use the MCP agent_metrics and trends tools for detailed analytics.'))
}

export async function analyticsSessionCommand(sessionId: string, _options: AnalyticsOptions) {
  console.log(chalk.bold(`Session Replay: ${sessionId}`))
  console.log(chalk.dim('Use the MCP session_replay tool for interactive session timeline.'))
  console.log(chalk.dim(`  session_replay({ sessionId: "${sessionId}" })`))
}

export async function analyticsTrendsCommand(options: AnalyticsOptions) {
  console.log(chalk.bold(`Analytics Trends${options.agent ? ` for ${options.agent}` : ''}`))
  console.log(chalk.dim('Use the MCP trends tool for recall hit rate, violation trends, and insights.'))
}
