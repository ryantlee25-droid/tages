import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface ImpactOptions {
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

export async function impactCommand(key: string, options: ImpactOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Impact analysis requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data: memories, error } = await supabase
    .from('memories')
    .select('key, cross_system_refs, confidence, updated_at, type')
    .eq('project_id', config.projectId)
    .eq('status', 'live')

  if (error || !memories) {
    console.error(chalk.red(`Failed: ${error?.message}`))
    process.exit(1)
  }

  // Build reverse edge map
  type MemRow = { key: string; cross_system_refs: string | null; confidence: number; updated_at: string }
  const refMap = new Map<string, string[]>() // key -> keys that reference it
  for (const mem of memories as MemRow[]) {
    const refs: string[] = mem.cross_system_refs ? JSON.parse(mem.cross_system_refs) : []
    for (const ref of refs) {
      if (!refMap.has(ref)) refMap.set(ref, [])
      refMap.get(ref)!.push(mem.key)
    }
  }

  const directDependents = refMap.get(key) || []
  const allKeys = new Set<string>()
  const queue = [...directDependents]
  while (queue.length > 0) {
    const k = queue.shift()!
    if (allKeys.has(k)) continue
    allKeys.add(k)
    const nextLevel = refMap.get(k) || []
    queue.push(...nextLevel)
  }

  console.log(chalk.bold(`Impact analysis for "${key}":`) + '\n')
  console.log(`  Direct dependents:  ${directDependents.length}`)
  console.log(`  Transitive impact:  ${allKeys.size} downstream memories`)

  if (directDependents.length > 0) {
    console.log(`\n  Dependents: ${directDependents.map(k => chalk.cyan(k)).join(', ')}`)
  } else {
    console.log(chalk.dim('\n  No memories depend on this key.'))
  }
}

export async function riskCommand(options: ImpactOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl) {
    console.error(chalk.yellow('Risk report requires Supabase connection.'))
    process.exit(1)
  }

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data: memories, error } = await supabase
    .from('memories')
    .select('key, cross_system_refs, confidence, updated_at, type')
    .eq('project_id', config.projectId)
    .eq('status', 'live')

  if (error || !memories) {
    console.error(chalk.red(`Failed: ${error?.message}`))
    process.exit(1)
  }

  type MemRow = { key: string; cross_system_refs: string | null; confidence: number; updated_at: string }
  const refMap = new Map<string, string[]>()
  for (const mem of memories as MemRow[]) {
    const refs: string[] = mem.cross_system_refs ? JSON.parse(mem.cross_system_refs) : []
    for (const ref of refs) {
      if (!refMap.has(ref)) refMap.set(ref, [])
      refMap.get(ref)!.push(mem.key)
    }
  }

  const scored = (memories as MemRow[]).map(mem => {
    const deps = refMap.get(mem.key) || []
    const ageDays = (Date.now() - new Date(mem.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    const risk = deps.length * (1 - mem.confidence) * Math.min(ageDays / 30, 1)
    return { key: mem.key, deps: deps.length, risk }
  }).sort((a, b) => b.risk - a.risk).slice(0, 10)

  console.log(chalk.bold('Top 10 Riskiest Memories:\n'))
  for (const s of scored) {
    const riskColor = s.risk > 3 ? chalk.red : s.risk > 1 ? chalk.yellow : chalk.green
    console.log(`  ${riskColor(`[${s.risk.toFixed(2)}]`)} ${chalk.bold(s.key)} — ${s.deps} dependents`)
  }
}
