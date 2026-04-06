import * as fs from 'fs'
import * as readline from 'readline'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import type { MemoryType } from '@tages/shared'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir, getConfigDir } from '../config/paths.js'
import { randomUUID } from 'crypto'

interface SessionWrapOptions {
  nonInteractive?: boolean
  summary?: string
  project?: string
}

const PENDING_FILE = () => `${getConfigDir()}/pending-session-notes.txt`

/**
 * End-of-session workflow: extract and persist codebase learnings.
 *
 * Interactive mode (default): prompts for a multi-line session summary.
 * Non-interactive mode (--non-interactive): reads pending-session-notes.txt,
 * processes it silently, then deletes it. Exits 0 if no file exists.
 */
export async function sessionWrapCommand(options: SessionWrapOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    if (options.nonInteractive) process.exit(0) // Silent exit for hooks
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  let summary: string

  if (options.nonInteractive) {
    const pendingPath = PENDING_FILE()
    if (!fs.existsSync(pendingPath)) {
      process.exit(0) // No pending notes — silent exit
    }
    summary = fs.readFileSync(pendingPath, 'utf-8').trim()
    if (!summary) {
      fs.unlinkSync(pendingPath)
      process.exit(0)
    }
    // Delete the file after reading
    fs.unlinkSync(pendingPath)
  } else if (options.summary) {
    summary = options.summary
  } else {
    // Interactive mode
    console.log(chalk.bold('\n  End-of-session wrap-up\n'))
    console.log(chalk.dim('  Summarize what you built, decided, or learned about this codebase.'))
    console.log(chalk.dim('  Codebase conventions, decisions, and gotchas only — not personal preferences.'))
    console.log(chalk.dim('  Press Enter twice to finish.\n'))

    summary = await readMultilineInput()
    if (!summary.trim()) {
      console.log(chalk.dim('\n  No summary provided. Nothing stored.'))
      return
    }
  }

  // Extract memories from the summary
  const extracted = extractMemoriesFromSummary(summary)

  if (extracted.length === 0) {
    if (!options.nonInteractive) {
      console.log(chalk.dim('\n  No codebase learnings extracted. Use `tages remember` for specific items.'))
    }
    return
  }

  // Persist extracted memories
  const now = new Date().toISOString()

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

    for (const mem of extracted) {
      await supabase.from('memories').upsert({
        project_id: config.projectId,
        key: mem.key,
        value: mem.value,
        type: mem.type,
        source: 'session-wrap',
        confidence: 0.8,
        file_paths: [],
        tags: ['session-extract'],
      }, { onConflict: 'project_id,key', ignoreDuplicates: false })
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

  for (const mem of extracted) {
    db.prepare(`INSERT OR REPLACE INTO memories (id, project_id, key, value, type, source, file_paths, tags, confidence, status, created_at, updated_at, dirty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(randomUUID(), config.projectId, mem.key, mem.value, mem.type, 'session-wrap',
        '[]', '["session-extract"]', 0.8, 'live', now, now)
  }
  db.close()

  // Print results
  if (!options.nonInteractive) {
    console.log(chalk.bold(`\n  Stored ${extracted.length} memories:\n`))
  }
  for (const mem of extracted) {
    const typeColor = getTypeColor(mem.type)
    if (options.nonInteractive) {
      console.log(`[tages] ${mem.type}: ${mem.key}`)
    } else {
      console.log(`  ${typeColor(mem.type.padEnd(12))} ${chalk.bold(mem.key)}`)
      console.log(`  ${chalk.dim('             ')}${mem.value}`)
      console.log()
    }
  }
}

// --- Extraction logic (inlined from server's session-extract.ts) ---

interface ExtractedMemory {
  key: string
  value: string
  type: MemoryType
}

function extractMemoriesFromSummary(summary: string): ExtractedMemory[] {
  const extracted: ExtractedMemory[] = []

  const lines = summary
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map(l => l.trim())
    .filter(l => l.length > 10)

  for (const line of lines) {
    const lower = line.toLowerCase()
    let type: MemoryType | null = null
    let key = ''

    if (/\b(decided|chose|went with|picked|selected|opted)\b/.test(lower)) {
      type = 'decision'
      key = `decision-${slugify(line.slice(0, 50))}`
    } else if (/\b(convention|pattern|always|never|must|naming|style)\b/.test(lower)) {
      type = 'convention'
      key = `convention-${slugify(line.slice(0, 50))}`
    } else if (/\b(architecture|module|structure|layer|boundary|directory|layout)\b/.test(lower)) {
      type = 'architecture'
      key = `arch-${slugify(line.slice(0, 50))}`
    } else if (/\b(learned|gotcha|watch out|careful|bug|issue|mistake|avoid)\b/.test(lower)) {
      type = 'lesson'
      key = `lesson-${slugify(line.slice(0, 50))}`
    } else if (/\b(created|added|new|built|implemented|introduced)\b/.test(lower)) {
      type = 'entity'
      key = `entity-${slugify(line.slice(0, 50))}`
    }

    if (type && key) {
      extracted.push({ key, value: line, type })
    }
  }

  return extracted
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// --- Helpers ---

function readMultilineInput(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const lines: string[] = []
    let lastLineEmpty = false

    rl.on('line', (line) => {
      if (line.trim() === '' && lastLineEmpty) {
        rl.close()
        return
      }
      lastLineEmpty = line.trim() === ''
      lines.push(line)
    })

    rl.on('close', () => {
      resolve(lines.join('\n'))
    })
  })
}

function getTypeColor(type: string) {
  const colors: Record<string, (s: string) => string> = {
    convention: chalk.blue,
    decision: chalk.magenta,
    architecture: chalk.green,
    entity: chalk.yellow,
    lesson: chalk.cyan,
    preference: chalk.gray,
    pattern: chalk.white,
    execution: chalk.red,
    operational: chalk.yellowBright,
    environment: chalk.blueBright,
  }
  return (colors[type] || chalk.white)
}

