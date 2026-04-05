/**
 * Sync Write-Ahead Log (WAL) for crash-safe Supabase sync.
 *
 * Before flushing dirty memories to Supabase, we log the operation here.
 * After a successful sync, we mark it complete. On startup, we replay any
 * incomplete operations to ensure nothing is lost.
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

export type WalOperation = 'upsert' | 'delete'

export interface PendingOp {
  id: string
  memoryId: string
  projectId: string
  operation: WalOperation
  payload: string // JSON-serialized memory (for upsert) or key (for delete)
  createdAt: string
}

const WAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_wal (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sync_wal_incomplete ON sync_wal(completed) WHERE completed = 0;
CREATE INDEX IF NOT EXISTS sync_wal_memory_id ON sync_wal(memory_id);
`

export class SyncWAL {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(WAL_SCHEMA)
    // Upgrade path for existing DBs
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS sync_wal (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`)
    } catch { /* already exists */ }
  }

  /**
   * Log a pending sync operation before the remote call.
   * Returns the WAL entry ID.
   */
  logPending(memoryId: string, projectId: string, operation: WalOperation, payload: unknown): string {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO sync_wal (id, memory_id, project_id, operation, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, memoryId, projectId, operation, JSON.stringify(payload))
    return id
  }

  /**
   * Mark a WAL entry as complete after a successful remote sync.
   */
  markComplete(id: string): void {
    this.db.prepare(
      `UPDATE sync_wal SET completed = 1 WHERE id = ?`
    ).run(id)
  }

  /**
   * Mark multiple WAL entries as complete (batch).
   */
  markCompleteByMemoryIds(memoryIds: string[]): void {
    if (memoryIds.length === 0) return
    const placeholders = memoryIds.map(() => '?').join(',')
    this.db.prepare(
      `UPDATE sync_wal SET completed = 1 WHERE memory_id IN (${placeholders}) AND completed = 0`
    ).run(...memoryIds)
  }

  /**
   * Get all incomplete WAL entries for crash recovery.
   */
  getIncomplete(): PendingOp[] {
    const rows = this.db.prepare(`
      SELECT id, memory_id, project_id, operation, payload, created_at
      FROM sync_wal
      WHERE completed = 0
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string
      memory_id: string
      project_id: string
      operation: string
      payload: string
      created_at: string
    }>
    return rows.map(r => ({
      id: r.id,
      memoryId: r.memory_id,
      projectId: r.project_id,
      operation: r.operation as WalOperation,
      payload: r.payload,
      createdAt: r.created_at,
    }))
  }

  /**
   * Get count of incomplete entries (for monitoring).
   */
  getPendingCount(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM sync_wal WHERE completed = 0`
    ).get() as { cnt: number }
    return row.cnt
  }

  /**
   * Prune completed entries older than the given number of days.
   */
  pruneCompleted(olderThanDays = 7): number {
    const result = this.db.prepare(`
      DELETE FROM sync_wal
      WHERE completed = 1 AND created_at < datetime('now', ?)
    `).run(`-${olderThanDays} days`)
    return result.changes
  }

  close(): void {
    this.db.close()
  }
}
