import * as readline from 'readline'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { sharpenMemory } from '../indexer/sharpen-client.js'
import type { Memory, MemoryType } from '@tages/shared'

interface SharpenOptions {
  project?: string
  all?: boolean
  yes?: boolean
}

const IMPERATIVE_TYPES: MemoryType[] = ['convention', 'anti_pattern', 'lesson']
const IMPERATIVE_WORDS = /^\s*(ALWAYS|NEVER|MUST|DO NOT|STOP|AVOID|REQUIRE|ENSURE|USE)\b/i

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question + ' [y/N] ', (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

async function sharpenOne(
  memory: Memory,
  config: ReturnType<typeof loadProjectConfig> & {},
  yes: boolean,
  index?: { current: number; total: number },
): Promise<boolean> {
  const prefix = index ? `[${index.current}/${index.total}] ` : ''
  console.log(`\n${prefix}${chalk.bold(memory.key)} ${chalk.dim(`(${memory.type})`)}`)
  console.log(chalk.dim('  Before: ') + memory.value)

  let rewritten: string
  try {
    rewritten = await sharpenMemory(memory.key, memory.value, memory.type)
  } catch (err) {
    console.error(chalk.red(`  Failed to sharpen: ${err instanceof Error ? err.message : String(err)}`))
    return false
  }

  console.log(chalk.green('  After:  ') + rewritten)

  if (!yes) {
    const ok = await confirm('  Apply this rewrite?')
    if (!ok) {
      console.log(chalk.dim('  Skipped.'))
      return false
    }
  }

  // Upsert via Supabase
  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
    const existingTags = memory.tags ?? []
    const newTags = existingTags.includes('sharpened') ? existingTags : [...existingTags, 'sharpened']

    await Promise.resolve(
      supabase.from('memories').upsert({
        project_id: memory.projectId,
        key: memory.key,
        value: rewritten,
        type: memory.type,
        source: memory.source,
        confidence: memory.confidence,
        file_paths: memory.filePaths ?? [],
        tags: newTags,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,key', ignoreDuplicates: false })
    )
  }

  console.log(chalk.green('  Applied.'))
  return true
}

export async function sharpenCommand(key: string | undefined, options: SharpenOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Sharpen requires Supabase connection.'))
    process.exit(1)
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(chalk.red('ANTHROPIC_API_KEY not set — required for Claude Haiku rewrite.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  if (options.all) {
    // Fetch all imperative-type memories that are not yet sharpened and not already imperative
    const { data: rows, error } = await Promise.resolve(
      supabase
        .from('memories')
        .select('id, project_id, key, value, type, source, status, confidence, file_paths, tags, created_at, updated_at')
        .eq('project_id', config.projectId)
        .eq('status', 'live')
    )

    if (error) {
      console.error(chalk.red(`Failed to fetch memories: ${error.message}`))
      process.exit(1)
    }

    const candidates = (rows ?? [])
      .map((r: Record<string, unknown>) => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        key: r['key'] as string,
        value: r['value'] as string,
        type: r['type'] as MemoryType,
        source: r['source'] as Memory['source'],
        status: r['status'] as Memory['status'],
        confidence: r['confidence'] as number,
        filePaths: (r['file_paths'] as string[] | null) ?? [],
        tags: (r['tags'] as string[] | null) ?? [],
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      } as Memory))
      .filter((m) =>
        IMPERATIVE_TYPES.includes(m.type) &&
        !IMPERATIVE_WORDS.test(m.value) &&
        !(m.tags ?? []).includes('sharpened')
      )

    if (candidates.length === 0) {
      console.log(chalk.dim('No un-sharpened candidates found.'))
      return
    }

    console.log(chalk.bold(`\n  Sharpen — ${candidates.length} candidates`))

    let applied = 0
    for (let i = 0; i < candidates.length; i++) {
      const ok = await sharpenOne(candidates[i], config, options.yes ?? false, {
        current: i + 1,
        total: candidates.length,
      })
      if (ok) applied++
    }

    console.log(chalk.bold(`\n  Done: ${applied}/${candidates.length} memories sharpened.\n`))
    return
  }

  // Single key mode
  if (!key) {
    console.error(chalk.red('Provide a memory key or use --all.'))
    process.exit(1)
  }

  const { data: row, error } = await Promise.resolve(
    supabase
      .from('memories')
      .select('id, project_id, key, value, type, source, status, confidence, file_paths, tags, created_at, updated_at')
      .eq('project_id', config.projectId)
      .eq('key', key)
      .single()
  )

  if (error || !row) {
    console.error(chalk.red(`Memory "${key}" not found.`))
    process.exit(1)
  }

  const memory: Memory = {
    id: (row as Record<string, unknown>)['id'] as string,
    projectId: (row as Record<string, unknown>)['project_id'] as string,
    key: (row as Record<string, unknown>)['key'] as string,
    value: (row as Record<string, unknown>)['value'] as string,
    type: (row as Record<string, unknown>)['type'] as MemoryType,
    source: (row as Record<string, unknown>)['source'] as Memory['source'],
    status: (row as Record<string, unknown>)['status'] as Memory['status'],
    confidence: (row as Record<string, unknown>)['confidence'] as number,
    filePaths: ((row as Record<string, unknown>)['file_paths'] as string[] | null) ?? [],
    tags: ((row as Record<string, unknown>)['tags'] as string[] | null) ?? [],
    createdAt: (row as Record<string, unknown>)['created_at'] as string,
    updatedAt: (row as Record<string, unknown>)['updated_at'] as string,
  }

  await sharpenOne(memory, config, options.yes ?? false)
  console.log()
}
