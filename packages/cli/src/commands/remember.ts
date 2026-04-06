import * as fs from 'fs'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import type { Memory, MemoryType } from '@tages/shared'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir } from '../config/paths.js'
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
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
    // Do not pass `id` in the upsert — when onConflict matches, Supabase
    // would try to overwrite the existing row's id with a new UUID, which
    // violates the FK constraint from memory_versions. Omitting id lets
    // Postgres keep the existing id on update and gen_random_uuid() on insert.
    const { error } = await supabase.from('memories').upsert({
      project_id: memory.projectId,
      key: memory.key,
      value: memory.value,
      type: memory.type,
      source: memory.source,
      file_paths: memory.filePaths,
      tags: memory.tags,
      confidence: memory.confidence,
    }, { onConflict: 'project_id,key', ignoreDuplicates: false })

    if (error) {
      console.error(chalk.red(`Failed to store memory: ${error.message}`))
      process.exit(1)
    }
  }

  // Always store to local SQLite cache
  const cacheDir = getCacheDir()
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const dbPath = `${cacheDir}/${config.slug || config.projectId}.db`
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    type TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', agent_name TEXT,
    file_paths TEXT DEFAULT '[]', tags TEXT DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'live', conditions TEXT, phases TEXT, cross_system_refs TEXT,
    examples TEXT, execution_flow TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, key)
  )`)
  db.prepare(`INSERT OR REPLACE INTO memories (id, project_id, key, value, type, source, file_paths, tags, confidence, status, created_at, updated_at, dirty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(memory.id, memory.projectId, memory.key, memory.value, memory.type, memory.source,
      JSON.stringify(memory.filePaths), JSON.stringify(memory.tags), memory.confidence, memory.status, memory.createdAt, memory.updatedAt)
  db.close()

  console.log(chalk.green('Stored:'), `"${key}" (${options.type})`)
}

