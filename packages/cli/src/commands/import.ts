import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'

type ImportStrategy = 'skip' | 'overwrite' | 'merge'

interface ImportOptions {
  strategy?: string
  project?: string
}

const VALID_TYPES: MemoryType[] = [
  'convention', 'decision', 'architecture', 'entity',
  'lesson', 'preference', 'pattern', 'execution',
]

export async function importCommand(file: string, options: ImportOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const strategy = (options.strategy || 'skip') as ImportStrategy
  if (!['skip', 'overwrite', 'merge'].includes(strategy)) {
    console.error(chalk.red(`Invalid strategy: ${strategy}. Use skip, overwrite, or merge.`))
    process.exit(1)
  }

  if (!fs.existsSync(file)) {
    console.error(chalk.red(`File not found: ${file}`))
    process.exit(1)
  }

  const ext = path.extname(file).toLowerCase()
  const format: 'json' | 'markdown' = ext === '.json' ? 'json' : 'markdown'

  const spinner = ora(`Reading ${file}...`).start()
  let content: string
  try {
    content = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    spinner.fail(`Failed to read file: ${(err as Error).message}`)
    process.exit(1)
  }

  if (!content.trim()) {
    spinner.info('File is empty — 0 memories imported')
    return
  }

  let rawMemories: Array<Record<string, unknown>>
  try {
    if (format === 'json') {
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) {
        spinner.fail('JSON file must contain an array of memory objects')
        process.exit(1)
      }
      rawMemories = parsed as Array<Record<string, unknown>>
    } else {
      rawMemories = parseMarkdown(content)
    }
  } catch (err) {
    spinner.fail(`Failed to parse file: ${(err as Error).message}`)
    process.exit(1)
  }

  if (rawMemories.length === 0) {
    spinner.info('No memories found in file — 0 imported')
    return
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    spinner.fail('Import requires a cloud connection. Run `tages init` to configure Supabase.')
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Fetch existing keys for duplicate checking
  const { data: existing } = await supabase
    .from('memories')
    .select('id, key, value, created_at')
    .eq('project_id', config.projectId)

  const existingMap = new Map<string, { id: string; value: string; createdAt: string }>()
  for (const row of (existing || [])) {
    existingMap.set(row.key, { id: row.id, value: row.value, createdAt: row.created_at })
  }

  spinner.text = `Importing ${rawMemories.length} memories...`

  let imported = 0
  let skipped = 0
  let merged = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const raw of rawMemories) {
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    const rawValue = typeof raw.value === 'string' ? raw.value.trim() : ''

    if (!key) {
      errors.push('Skipped memory with missing key')
      continue
    }
    if (!rawValue) {
      errors.push(`Skipped "${key}" with empty value`)
      continue
    }

    const dup = existingMap.get(key)

    if (dup && strategy === 'skip') {
      skipped++
      continue
    }

    let finalValue = rawValue
    if (dup && strategy === 'merge') {
      finalValue = `${dup.value}\n\n${finalValue}`
    }

    const memType: MemoryType = VALID_TYPES.includes(raw.type as MemoryType)
      ? (raw.type as MemoryType)
      : 'convention'

    const memory: Memory = {
      id: dup?.id || randomUUID(),
      projectId: config.projectId,
      key,
      value: finalValue,
      type: memType,
      source: 'import',
      status: 'live',
      filePaths: Array.isArray(raw.filePaths)
        ? (raw.filePaths as string[])
        : (Array.isArray(raw.file_paths) ? (raw.file_paths as string[]) : []),
      tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 1.0,
      agentName: typeof raw.agentName === 'string' ? raw.agentName : undefined,
      conditions: Array.isArray(raw.conditions) ? (raw.conditions as string[]) : undefined,
      phases: Array.isArray(raw.phases) ? (raw.phases as string[]) : undefined,
      crossSystemRefs: Array.isArray(raw.crossSystemRefs) ? (raw.crossSystemRefs as string[]) : undefined,
      createdAt: dup?.createdAt || now,
      updatedAt: now,
    }

    // Omit `id` from upsert — passing a new UUID on conflict overwrites
    // the existing row's id, which violates FK from memory_versions.
    const { error } = await supabase.from('memories').upsert({
      project_id: memory.projectId,
      key: memory.key,
      value: memory.value,
      type: memory.type,
      source: memory.source,
      status: memory.status,
      file_paths: memory.filePaths,
      tags: memory.tags,
      confidence: memory.confidence,
    }, { onConflict: 'project_id,key', ignoreDuplicates: false })

    if (error) {
      errors.push(`Failed to store "${key}": ${error.message}`)
      continue
    }

    existingMap.set(key, { id: memory.id, value: finalValue, createdAt: memory.createdAt })

    if (dup && strategy === 'merge') {
      merged++
    } else {
      imported++
    }

    const statusParts = [`${imported} imported`]
    if (skipped > 0) statusParts.push(`${skipped} skipped`)
    if (merged > 0) statusParts.push(`${merged} merged`)
    spinner.text = `Importing ${rawMemories.length} memories... (${statusParts.join(', ')})`
  }

  const resultParts = [`${imported} imported`]
  if (skipped > 0) resultParts.push(`${skipped} skipped`)
  if (merged > 0) resultParts.push(`${merged} merged`)

  spinner.succeed(
    chalk.green(`Imported from ${path.basename(file)}: `) + resultParts.join(', ')
  )

  if (errors.length > 0) {
    console.log(chalk.yellow(`\n  ${errors.length} warning(s):`))
    for (const e of errors) {
      console.log(chalk.dim(`    - ${e}`))
    }
  }
}

/**
 * Parse Markdown format:
 * ## type
 * ### key
 * value body text
 */
export function parseMarkdown(content: string): Array<Record<string, unknown>> {
  const memories: Array<Record<string, unknown>> = []
  const typeSections = content.split(/^## /m).filter(s => s.trim())

  for (const section of typeSections) {
    const lines = section.split('\n')
    const type = lines[0].trim().toLowerCase()
    const body = lines.slice(1).join('\n')
    const keySections = body.split(/^### /m).filter(s => s.trim())

    for (const keySection of keySections) {
      const keyLines = keySection.split('\n')
      const key = keyLines[0].trim()
      const value = keyLines.slice(1).join('\n').trim()
      if (key && value) {
        memories.push({ key, value, type })
      }
    }
  }

  return memories
}

