/**
 * Local-first SQLite log for captured Claude Code hook events.
 *
 * Mirrors packages/server/src/cache/query-log.ts's pattern: plain
 * better-sqlite3, WAL mode, a single append-only table, no ORM.
 *
 * This module compiles to CommonJS (see ../package.json's "type": "commonjs"
 * and ../tsconfig.json's Node16 module setting) specifically so the CLI's
 * `tages harness sync` command can reach it via createRequire + a dist path
 * walk, the same cross-package pattern packages/cli/src/sync/cli-sync.ts
 * already uses to load @tages/server's CJS dist from the ESM CLI. See
 * memory `feedback_esm_cjs_crosspackage`.
 */
import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { HarnessEvent } from '@tages/shared'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS harness_tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  agent_name TEXT,
  tool_name TEXT,
  exit_code INTEGER,
  file_path TEXT,
  duration_ms INTEGER,
  args_scrubbed TEXT,
  result_summary TEXT,
  secrets_redacted_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS hte_session_id ON harness_tool_events(session_id);
CREATE INDEX IF NOT EXISTS hte_synced_at ON harness_tool_events(synced_at);
`

/** A row as stored/read back from the local SQLite log. Superset of
 * HarnessEvent — adds the local autoincrement id and sync bookkeeping that
 * only make sense once an event has actually been persisted locally. */
export interface HarnessEventRow {
  id: number
  source: string
  sessionId: string
  eventType: string
  agentName: string | null
  toolName: string | null
  exitCode: number | null
  filePath: string | null
  durationMs: number | null
  argsScrubbed: Record<string, unknown> | null
  resultSummary: string | null
  secretsRedactedCount: number
  createdAt: string
  syncedAt: string | null
}

interface RawRow {
  id: number
  source: string
  session_id: string
  event_type: string
  agent_name: string | null
  tool_name: string | null
  exit_code: number | null
  file_path: string | null
  duration_ms: number | null
  args_scrubbed: string | null
  result_summary: string | null
  secrets_redacted_count: number
  created_at: string
  synced_at: string | null
}

function toRow(raw: RawRow): HarnessEventRow {
  let argsScrubbed: Record<string, unknown> | null = null
  if (raw.args_scrubbed) {
    try {
      argsScrubbed = JSON.parse(raw.args_scrubbed)
    } catch {
      // Corrupt JSON in an old row should never crash a read — surface as null.
      argsScrubbed = null
    }
  }

  return {
    id: raw.id,
    source: raw.source,
    sessionId: raw.session_id,
    eventType: raw.event_type,
    agentName: raw.agent_name,
    toolName: raw.tool_name,
    exitCode: raw.exit_code,
    filePath: raw.file_path,
    durationMs: raw.duration_ms,
    argsScrubbed,
    resultSummary: raw.result_summary,
    secretsRedactedCount: raw.secrets_redacted_count,
    createdAt: raw.created_at,
    syncedAt: raw.synced_at,
  }
}

/**
 * Resolves ~/.config/tages/cache/<slug>-harness.db without depending on
 * @tages/cli (that would invert the intended dependency direction — the CLI
 * depends on this package, not the other way around). Slug resolution
 * mirrors packages/cli/src/config/project.ts's detectSlugFromCwd(): a
 * `.tages/config.json` marker's `slug` field, falling back to a sanitized
 * cwd directory name.
 */
export function detectSlug(cwd: string): string {
  const markerPath = path.join(cwd, '.tages', 'config.json')
  if (fs.existsSync(markerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      if (marker && typeof marker.slug === 'string' && marker.slug) return marker.slug
    } catch {
      // Marker corrupt — fall through to directory name detection.
    }
  }
  const dirName = path.basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return dirName || 'default'
}

export function getHarnessCacheDir(): string {
  return path.join(os.homedir(), '.config', 'tages', 'cache')
}

export function getHarnessDbPath(cwd: string = process.cwd()): string {
  const slug = detectSlug(cwd)
  return path.join(getHarnessCacheDir(), `${slug}-harness.db`)
}

export class HarnessLog {
  private db: Database.Database

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  append(event: HarnessEvent): void {
    this.db.prepare(`
      INSERT INTO harness_tool_events (
        source, session_id, event_type, agent_name, tool_name, exit_code,
        file_path, duration_ms, args_scrubbed, result_summary,
        secrets_redacted_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.source,
      event.sessionId,
      event.eventType,
      event.agentName ?? null,
      event.toolName ?? null,
      event.exitCode ?? null,
      event.filePath ?? null,
      event.durationMs ?? null,
      event.argsScrubbed ? JSON.stringify(event.argsScrubbed) : null,
      event.resultSummary ?? null,
      event.secretsRedactedCount,
      event.createdAt,
    )
  }

  /** Total row count — used by `tages harness status`. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM harness_tool_events').get() as { n: number }
    return row.n
  }

  /** Rows never yet batch-synced to Supabase (synced_at IS NULL). */
  getUnsynced(limit = 500): HarnessEventRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM harness_tool_events
      WHERE synced_at IS NULL
      ORDER BY id ASC
      LIMIT ?
    `).all(limit) as RawRow[]
    return rows.map(toRow)
  }

  pendingCount(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as n FROM harness_tool_events WHERE synced_at IS NULL',
    ).get() as { n: number }
    return row.n
  }

  /** Marks the given local row ids as synced (called after a successful
   * batch insert into Supabase's harness_tool_events table). */
  markSynced(ids: number[]): void {
    if (ids.length === 0) return
    const now = new Date().toISOString()
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(
      `UPDATE harness_tool_events SET synced_at = ? WHERE id IN (${placeholders})`,
    ).run(now, ...ids)
  }

  lastSyncedAt(): string | null {
    const row = this.db.prepare(
      'SELECT MAX(synced_at) as t FROM harness_tool_events',
    ).get() as { t: string | null }
    return row.t
  }

  close(): void {
    this.db.close()
  }
}
