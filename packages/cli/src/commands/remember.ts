import chalk from 'chalk'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { randomUUID } from 'crypto'
import { openCliSync } from '../sync/cli-sync.js'
import { extractDates } from '../lib/date-extraction.js'

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

  // Temporal anchoring (Task C / migration 0060): extract absolute/relative
  // dates referenced in the memory text, resolved against the write time.
  // Runs inline — regex-based extraction is local/cheap with no network
  // call, so it must be set before the memory is constructed/upserted.
  const extractedDates = extractDates(`${key} ${value}`, new Date(now))

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
    referencedDate: extractedDates.referencedDate,
    relativeDate: extractedDates.relativeDate,
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

