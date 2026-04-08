import chalk from 'chalk'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { randomUUID } from 'crypto'
import { openCliSync } from '../sync/cli-sync.js'

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

  const { cache, flush, close } = await openCliSync(config)
  try {
    // Primary write: SQLite first (dirty=1 marks it for sync)
    cache.upsertMemory(memory, true)

    // Best-effort cloud sync — never fatal
    await flush()
  } finally {
    close()
  }

  console.log(chalk.green('Stored:'), `"${key}" (${options.type})`)
}

