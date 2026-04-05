import Database from 'better-sqlite3'
import * as path from 'path'
import * as os from 'os'
import type { Memory } from '@tages/shared'

const ARCHIVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_archive (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_data TEXT NOT NULL,
  archive_reason TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS archive_project ON memory_archive(project_id);
CREATE INDEX IF NOT EXISTS archive_key ON memory_archive(project_id, memory_key);

CREATE TABLE IF NOT EXISTS archive_stats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  total_archived INTEGER NOT NULL DEFAULT 0,
  total_restored INTEGER NOT NULL DEFAULT 0,
  total_expired INTEGER NOT NULL DEFAULT 0,
  last_archive_at TEXT,
  last_restore_at TEXT
);
`

export interface ArchiveEntry {
  id: string
  projectId: string
  memoryKey: string
  memory: Memory
  archiveReason: string
  archivedAt: string
  expiresAt?: string
}

export interface ArchiveStats {
  projectId: string
  totalArchived: number
  totalRestored: number
  totalExpired: number
  lastArchiveAt?: string
  lastRestoreAt?: string
}

export class ColdStorage {
  private db: Database.Database
  private retentionDays: number

  constructor(dbPath?: string, retentionDays = 90) {
    const archivePath = dbPath || path.join(os.tmpdir(), 'tages-archive.db')
    this.db = new Database(archivePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(ARCHIVE_SCHEMA)
    this.retentionDays = retentionDays
  }

  archive(memory: Memory, reason: string): ArchiveEntry {
    const id = `arch-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const archivedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + this.retentionDays * 24 * 60 * 60 * 1000).toISOString()

    this.db.prepare(`
      INSERT OR REPLACE INTO memory_archive (id, project_id, memory_key, memory_data, archive_reason, archived_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, memory.projectId, memory.key, JSON.stringify(memory), reason, archivedAt, expiresAt)

    this.incrementStat(memory.projectId, 'total_archived', archivedAt, null)

    return { id, projectId: memory.projectId, memoryKey: memory.key, memory, archiveReason: reason, archivedAt, expiresAt }
  }

  getArchived(projectId: string, key: string): ArchiveEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM memory_archive WHERE project_id = ? AND memory_key = ? ORDER BY archived_at DESC LIMIT 1'
    ).get(projectId, key) as { id: string; project_id: string; memory_key: string; memory_data: string; archive_reason: string; archived_at: string; expires_at: string | null } | undefined
    if (!row) return null
    return {
      id: row.id,
      projectId: row.project_id,
      memoryKey: row.memory_key,
      memory: JSON.parse(row.memory_data) as Memory,
      archiveReason: row.archive_reason,
      archivedAt: row.archived_at,
      expiresAt: row.expires_at || undefined,
    }
  }

  listArchived(projectId: string, limit = 50): ArchiveEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM memory_archive WHERE project_id = ? ORDER BY archived_at DESC LIMIT ?'
    ).all(projectId, limit) as Array<{ id: string; project_id: string; memory_key: string; memory_data: string; archive_reason: string; archived_at: string; expires_at: string | null }>
    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      memoryKey: r.memory_key,
      memory: JSON.parse(r.memory_data) as Memory,
      archiveReason: r.archive_reason,
      archivedAt: r.archived_at,
      expiresAt: r.expires_at || undefined,
    }))
  }

  deleteArchive(projectId: string, key: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM memory_archive WHERE project_id = ? AND memory_key = ?'
    ).run(projectId, key)
    return result.changes > 0
  }

  recordRestore(projectId: string): void {
    this.incrementStat(projectId, 'total_restored', null, new Date().toISOString())
  }

  enforceRetention(): number {
    const now = new Date().toISOString()
    // Get counts first for stat update
    const expiredRows = this.db.prepare(
      'SELECT project_id, COUNT(*) as cnt FROM memory_archive WHERE expires_at IS NOT NULL AND expires_at < ? GROUP BY project_id'
    ).all(now) as Array<{ project_id: string; cnt: number }>

    const result = this.db.prepare(
      'DELETE FROM memory_archive WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).run(now)

    for (const row of expiredRows) {
      this.db.prepare(`
        INSERT INTO archive_stats (id, project_id, total_archived, total_restored, total_expired)
        VALUES (?, ?, 0, 0, ?)
        ON CONFLICT(id) DO UPDATE SET total_expired = total_expired + ?
      `).run(`stat-${row.project_id}`, row.project_id, row.cnt, row.cnt)
    }

    return result.changes
  }

  getStats(projectId: string): ArchiveStats {
    const row = this.db.prepare(
      'SELECT * FROM archive_stats WHERE project_id = ?'
    ).get(projectId) as {
      project_id: string; total_archived: number; total_restored: number
      total_expired: number; last_archive_at: string | null; last_restore_at: string | null
    } | undefined

    if (!row) {
      return { projectId, totalArchived: 0, totalRestored: 0, totalExpired: 0 }
    }

    return {
      projectId: row.project_id,
      totalArchived: row.total_archived,
      totalRestored: row.total_restored,
      totalExpired: row.total_expired,
      lastArchiveAt: row.last_archive_at || undefined,
      lastRestoreAt: row.last_restore_at || undefined,
    }
  }

  close(): void {
    this.db.close()
  }

  private incrementStat(
    projectId: string,
    field: 'total_archived' | 'total_restored',
    archiveAt: string | null,
    restoreAt: string | null,
  ): void {
    const initArchived = field === 'total_archived' ? 1 : 0
    const initRestored = field === 'total_restored' ? 1 : 0
    this.db.prepare(`
      INSERT INTO archive_stats (id, project_id, total_archived, total_restored, total_expired, last_archive_at, last_restore_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        ${field} = ${field} + 1,
        last_archive_at = COALESCE(?, last_archive_at),
        last_restore_at = COALESCE(?, last_restore_at)
    `).run(`stat-${projectId}`, projectId, initArchived, initRestored, archiveAt, restoreAt, archiveAt, restoreAt)
  }
}
