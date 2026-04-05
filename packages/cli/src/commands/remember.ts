import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import type { Memory, MemoryType } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'
import { randomUUID } from 'crypto'

interface RememberOptions {
  type: string
  project?: string
  filePaths?: string[]
  tags?: string[]
}

export async function rememberCommand(key: string, value: string, options: RememberOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const now = new Date().toISOString()
  const memory: Memory = {
    id: randomUUID(),
    projectId: config.projectId,
    key,
    value,
    type: options.type as MemoryType,
    source: 'manual',
    filePaths: options.filePaths || [],
    tags: options.tags || [],
    status: 'live',
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
  }

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
    const { error } = await supabase.from('memories').upsert({
      id: memory.id,
      project_id: memory.projectId,
      key: memory.key,
      value: memory.value,
      type: memory.type,
      source: memory.source,
      file_paths: memory.filePaths,
      tags: memory.tags,
      confidence: memory.confidence,
    }, { onConflict: 'project_id,key' })

    if (error) {
      console.error(chalk.red(`Failed to store memory: ${error.message}`))
      process.exit(1)
    }
  }

  console.log(chalk.green('Stored:'), `"${key}" (${options.type})`)
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
