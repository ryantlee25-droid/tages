import Database from 'better-sqlite3'
import type { Memory, MemoryType, MemorySource } from '@tages/shared'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  agent_name TEXT,
  file_paths TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  embedding TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS memories_project_key ON memories(project_id, key);
CREATE INDEX IF NOT EXISTS memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS memories_type ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS memories_dirty ON memories(dirty) WHERE dirty = 1;

CREATE TABLE IF NOT EXISTS sync_meta (
  project_id TEXT PRIMARY KEY,
  last_synced_at TEXT,
  memory_count INTEGER NOT NULL DEFAULT 0
);
`

export class SqliteCache {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(SCHEMA)
    // Add embedding column if missing (upgrade path)
    try { this.db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT') } catch { /* already exists */ }
  }

  upsertMemory(memory: Memory, dirty = true): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, created_at, updated_at, dirty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, key) DO UPDATE SET
        id = excluded.id,
        value = excluded.value,
        type = excluded.type,
        source = excluded.source,
        agent_name = excluded.agent_name,
        file_paths = excluded.file_paths,
        tags = excluded.tags,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at,
        dirty = excluded.dirty
    `)
    stmt.run(
      memory.id,
      memory.projectId,
      memory.key,
      memory.value,
      memory.type,
      memory.source,
      memory.agentName || null,
      JSON.stringify(memory.filePaths || []),
      JSON.stringify(memory.tags || []),
      memory.confidence,
      memory.createdAt,
      memory.updatedAt,
      dirty ? 1 : 0,
    )
  }

  upsertMemoryWithEmbedding(memory: Memory, embedding: number[], dirty = true): void {
    this.upsertMemory(memory, dirty)
    this.db.prepare(
      'UPDATE memories SET embedding = ? WHERE id = ?'
    ).run(JSON.stringify(embedding), memory.id)
  }

  /**
   * Semantic search using local cosine similarity on cached embeddings.
   * No network call needed — runs entirely from SQLite.
   */
  semanticQuery(projectId: string, queryEmbedding: number[], type?: MemoryType, limit = 5): Memory[] {
    // Get all memories with embeddings for this project
    let sql = 'SELECT * FROM memories WHERE project_id = ? AND embedding IS NOT NULL'
    const params: unknown[] = [projectId]
    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    const rows = this.db.prepare(sql).all(...params) as (SqliteMemoryRow & { embedding: string | null })[]

    // Score by cosine similarity
    const scored: Array<{ row: SqliteMemoryRow; sim: number }> = []
    for (const row of rows) {
      if (!row.embedding) continue
      const emb = JSON.parse(row.embedding) as number[]
      const sim = cosineSimilarity(queryEmbedding, emb)
      if (sim > 0.3) scored.push({ row, sim })
    }
    scored.sort((a, b) => b.sim - a.sim)

    return scored.slice(0, limit).map(s => rowToMemory(s.row))
  }

  queryMemories(projectId: string, query: string, type?: MemoryType, limit = 5): Memory[] {
    const pattern = `%${query}%`
    let sql = `
      SELECT * FROM memories
      WHERE project_id = ? AND (key LIKE ? OR value LIKE ?)
    `
    const params: unknown[] = [projectId, pattern, pattern]

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?'
    params.push(limit)

    const rows = this.db.prepare(sql).all(...params) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  getByKey(projectId: string, key: string): Memory | null {
    const row = this.db.prepare(
      'SELECT * FROM memories WHERE project_id = ? AND key = ?'
    ).get(projectId, key) as SqliteMemoryRow | undefined
    return row ? rowToMemory(row) : null
  }

  getByType(projectId: string, type: MemoryType): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE project_id = ? AND type = ? ORDER BY updated_at DESC'
    ).all(projectId, type) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  getByFilePath(projectId: string, filePath: string): Memory[] {
    const pattern = `%${filePath}%`
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE project_id = ? AND file_paths LIKE ? ORDER BY updated_at DESC'
    ).all(projectId, pattern) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  deleteByKey(projectId: string, key: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM memories WHERE project_id = ? AND key = ?'
    ).run(projectId, key)
    return result.changes > 0
  }

  getAllForProject(projectId: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(projectId) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  getDirty(): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE dirty = 1'
    ).all() as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  markSynced(ids: string[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`
      UPDATE memories SET dirty = 0, synced_at = datetime('now')
      WHERE id IN (${placeholders})
    `).run(...ids)
  }

  hydrateFromRemote(memories: Memory[]): void {
    const upsert = this.db.transaction((mems: Memory[]) => {
      for (const mem of mems) {
        this.upsertMemory(mem, false)
      }
    })
    upsert(memories)
  }

  // --- Sync metadata ---

  getLastSyncedAt(projectId: string): string | null {
    const row = this.db.prepare(
      'SELECT last_synced_at FROM sync_meta WHERE project_id = ?'
    ).get(projectId) as { last_synced_at: string | null } | undefined
    return row?.last_synced_at || null
  }

  setLastSyncedAt(projectId: string, timestamp: string, count: number): void {
    this.db.prepare(`
      INSERT INTO sync_meta (project_id, last_synced_at, memory_count)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        memory_count = excluded.memory_count
    `).run(projectId, timestamp, count)
  }

  getMemoryCount(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM memories WHERE project_id = ?'
    ).get(projectId) as { cnt: number }
    return row.cnt
  }

  close(): void {
    this.db.close()
  }
}

interface SqliteMemoryRow {
  id: string
  project_id: string
  key: string
  value: string
  type: string
  source: string
  agent_name: string | null
  file_paths: string
  tags: string
  confidence: number
  created_at: string
  updated_at: string
  synced_at: string | null
  dirty: number
}

function rowToMemory(row: SqliteMemoryRow): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    value: row.value,
    type: row.type as MemoryType,
    source: row.source as MemorySource,
    agentName: row.agent_name || undefined,
    filePaths: JSON.parse(row.file_paths),
    tags: JSON.parse(row.tags),
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
