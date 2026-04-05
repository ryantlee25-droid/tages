import Database from 'better-sqlite3'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS query_miss_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  query TEXT NOT NULL,
  missed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS qml_project_id ON query_miss_log(project_id);
CREATE INDEX IF NOT EXISTS qml_project_query ON query_miss_log(project_id, query);
`

interface MissRow {
  id: number
  project_id: string
  query: string
  missed_at: string
}

export interface MissPattern {
  query: string
  count: number
  lastMissedAt: string
}

export class QueryLog {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  logMiss(projectId: string, query: string): void {
    if (!query.trim()) return
    this.db.prepare(
      'INSERT INTO query_miss_log (project_id, query) VALUES (?, ?)',
    ).run(projectId, query.trim().toLowerCase())
  }

  getMisses(projectId: string): MissRow[] {
    return this.db.prepare(
      'SELECT * FROM query_miss_log WHERE project_id = ? ORDER BY missed_at DESC'
    ).all(projectId) as MissRow[]
  }

  getTopMissPatterns(projectId: string, limit = 10): MissPattern[] {
    const rows = this.db.prepare(`
      SELECT query, COUNT(*) as count, MAX(missed_at) as last_missed_at
      FROM query_miss_log
      WHERE project_id = ?
      GROUP BY query
      ORDER BY count DESC, last_missed_at DESC
      LIMIT ?
    `).all(projectId, limit) as { query: string; count: number; last_missed_at: string }[]

    return rows.map((r) => ({
      query: r.query,
      count: r.count,
      lastMissedAt: r.last_missed_at,
    }))
  }

  clearMisses(projectId: string): void {
    this.db.prepare('DELETE FROM query_miss_log WHERE project_id = ?').run(projectId)
  }

  close(): void {
    this.db.close()
  }
}
