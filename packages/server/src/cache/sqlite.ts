import Database from 'better-sqlite3'
import { chmodSync, existsSync } from 'fs'
import { randomUUID as _randomUUID } from 'crypto'
import type { Memory, MemoryType, MemorySource, MemoryStatus } from '@tages/shared'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  version INTEGER NOT NULL DEFAULT 1,
  changed_by TEXT,
  change_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mv_memory_id ON memory_versions(memory_id);
CREATE INDEX IF NOT EXISTS mv_project_key ON memory_versions(project_id, key);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_a_key TEXT NOT NULL,
  memory_b_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution_strategy TEXT,
  merged_value TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS mc_project_id ON memory_conflicts(project_id);
CREATE INDEX IF NOT EXISTS mc_unresolved ON memory_conflicts(project_id, resolved) WHERE resolved = 0;

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
  embedding TEXT,
  status TEXT NOT NULL DEFAULT 'live',
  conditions TEXT,
  phases TEXT,
  cross_system_refs TEXT,
  examples TEXT,
  execution_flow TEXT,
  verified_at TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0
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
    // Restrict file permissions — cache contains proprietary codebase data
    try { chmodSync(dbPath, 0o600) } catch { /* may fail on Windows */ }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(SCHEMA)
    // Upgrade path: create new tables on existing DBs
    const tableUpgrades = [
      `CREATE TABLE IF NOT EXISTS memory_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        version INTEGER NOT NULL DEFAULT 1,
        changed_by TEXT,
        change_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS mv_memory_id ON memory_versions(memory_id)`,
      `CREATE INDEX IF NOT EXISTS mv_project_key ON memory_versions(project_id, key)`,
      `CREATE TABLE IF NOT EXISTS memory_conflicts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        memory_a_key TEXT NOT NULL,
        memory_b_key TEXT NOT NULL,
        reason TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolution_strategy TEXT,
        merged_value TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS mc_project_id ON memory_conflicts(project_id)`,
    ]
    for (const sql of tableUpgrades) {
      try { this.db.exec(sql) } catch { /* already exists */ }
    }

    // Upgrade path: add columns if missing on existing DBs
    const upgrades = [
      'ALTER TABLE memories ADD COLUMN synced_at TEXT',
      'ALTER TABLE memories ADD COLUMN embedding TEXT',
      'ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT \'live\'',
      'ALTER TABLE memories ADD COLUMN conditions TEXT',
      'ALTER TABLE memories ADD COLUMN phases TEXT',
      'ALTER TABLE memories ADD COLUMN cross_system_refs TEXT',
      'ALTER TABLE memories ADD COLUMN examples TEXT',
      'ALTER TABLE memories ADD COLUMN execution_flow TEXT',
      'ALTER TABLE memories ADD COLUMN verified_at TEXT',
      // T6: decay tracking
      'ALTER TABLE memories ADD COLUMN last_accessed_at TEXT',
      'ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0',
      // T3: conflict base value
      'ALTER TABLE memory_conflicts ADD COLUMN merge_base_value TEXT',
      // C1: encrypted flag
      'ALTER TABLE memories ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0',
    ]
    for (const sql of upgrades) {
      try { this.db.exec(sql) } catch { /* already exists */ }
    }

    // T5: field_changes table
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS field_changes (
          id TEXT PRIMARY KEY,
          version_id TEXT NOT NULL,
          memory_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          change_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS fc_version_id ON field_changes(version_id);
        CREATE INDEX IF NOT EXISTS fc_memory_id ON field_changes(memory_id);
      `)
    } catch { /* already exists */ }

    // T7: session branches
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_branches (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          parent_branch TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS mb_session_id ON memory_branches(session_id);

        CREATE TABLE IF NOT EXISTS branch_memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          memory_key TEXT NOT NULL,
          memory_data TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (session_id, memory_key)
        );
        CREATE INDEX IF NOT EXISTS bm_session_id ON branch_memories(session_id);
      `)
    } catch { /* already exists */ }

    // T8: token index
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS token_index (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          token TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS ti_memory_id ON token_index(memory_id);
        CREATE INDEX IF NOT EXISTS ti_project_token ON token_index(project_id, token);
      `)
    } catch { /* already exists */ }
  }

  upsertMemory(memory: Memory, dirty = true): void {
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, created_at, updated_at, dirty, status, conditions, phases, cross_system_refs, examples, execution_flow, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, key) DO UPDATE SET
        value = excluded.value,
        type = excluded.type,
        source = excluded.source,
        agent_name = excluded.agent_name,
        file_paths = excluded.file_paths,
        tags = excluded.tags,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at,
        dirty = excluded.dirty,
        status = excluded.status,
        conditions = excluded.conditions,
        phases = excluded.phases,
        cross_system_refs = excluded.cross_system_refs,
        examples = excluded.examples,
        execution_flow = excluded.execution_flow,
        encrypted = excluded.encrypted
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
      memory.status || 'live',
      memory.conditions ? JSON.stringify(memory.conditions) : null,
      memory.phases ? JSON.stringify(memory.phases) : null,
      memory.crossSystemRefs ? JSON.stringify(memory.crossSystemRefs) : null,
      memory.examples ? JSON.stringify(memory.examples) : null,
      memory.executionFlow ? JSON.stringify(memory.executionFlow) : null,
      memory.encrypted ? 1 : 0,
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
    let sql = "SELECT * FROM memories WHERE project_id = ? AND status = 'live' AND embedding IS NOT NULL"
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
      WHERE project_id = ? AND status = 'live' AND (key LIKE ? OR value LIKE ?)
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

  getPendingMemories(projectId: string): Memory[] {
    const rows = this.db.prepare(
      'SELECT * FROM memories WHERE project_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(projectId, 'pending') as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  updateMemoryStatus(id: string, status: MemoryStatus, verifiedAt?: string): void {
    if (verifiedAt) {
      this.db.prepare(
        'UPDATE memories SET status = ?, verified_at = ?, dirty = 1 WHERE id = ?'
      ).run(status, verifiedAt, id)
    } else {
      this.db.prepare(
        'UPDATE memories SET status = ?, dirty = 1 WHERE id = ?'
      ).run(status, id)
    }
  }

  // --- Memory versioning ---

  addVersion(
    projectId: string,
    key: string,
    value: string,
    confidence: number,
    changedBy?: string,
    changeReason?: string,
  ): void {
    const mem = this.getByKey(projectId, key)
    const memoryId = mem?.id || key
    const maxRow = this.db.prepare(
      'SELECT MAX(version) as max_version FROM memory_versions WHERE project_id = ? AND key = ?'
    ).get(projectId, key) as { max_version: number | null }
    const version = (maxRow.max_version || 0) + 1
    const { randomUUID } = require('crypto') as { randomUUID: () => string }
    this.db.prepare(`
      INSERT INTO memory_versions (id, project_id, memory_id, key, value, confidence, version, changed_by, change_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), projectId, memoryId, key, value, confidence, version, changedBy || null, changeReason || null)
  }

  getVersions(projectId: string, key: string): Array<{
    version: number
    value: string
    confidence: number
    changedBy: string | null
    changeReason: string | null
    createdAt: string
  }> {
    const rows = this.db.prepare(`
      SELECT version, value, confidence, changed_by, change_reason, created_at
      FROM memory_versions
      WHERE project_id = ? AND key = ?
      ORDER BY version DESC
    `).all(projectId, key) as Array<{
      version: number
      value: string
      confidence: number
      changed_by: string | null
      change_reason: string | null
      created_at: string
    }>
    return rows.map((r) => ({
      version: r.version,
      value: r.value,
      confidence: r.confidence,
      changedBy: r.changed_by,
      changeReason: r.change_reason,
      createdAt: r.created_at,
    }))
  }

  revertToVersion(projectId: string, key: string, version: number): boolean {
    const row = this.db.prepare(`
      SELECT value, confidence FROM memory_versions
      WHERE project_id = ? AND key = ? AND version = ?
    `).get(projectId, key, version) as { value: string; confidence: number } | undefined
    if (!row) return false
    const mem = this.getByKey(projectId, key)
    if (!mem) return false
    this.upsertMemory({ ...mem, value: row.value, confidence: row.confidence, updatedAt: new Date().toISOString() })
    return true
  }

  // --- Conflict tracking ---

  addConflict(projectId: string, memoryAKey: string, memoryBKey: string, reason: string): string {
    const { randomUUID } = require('crypto') as { randomUUID: () => string }
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO memory_conflicts (id, project_id, memory_a_key, memory_b_key, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, memoryAKey, memoryBKey, reason)
    return id
  }

  getConflict(conflictId: string): {
    id: string
    projectId: string
    memoryAKey: string
    memoryBKey: string
    reason: string
    resolved: boolean
  } | null {
    const row = this.db.prepare(
      'SELECT * FROM memory_conflicts WHERE id = ?'
    ).get(conflictId) as {
      id: string; project_id: string; memory_a_key: string; memory_b_key: string; reason: string; resolved: number
    } | undefined
    if (!row) return null
    return {
      id: row.id,
      projectId: row.project_id,
      memoryAKey: row.memory_a_key,
      memoryBKey: row.memory_b_key,
      reason: row.reason,
      resolved: row.resolved === 1,
    }
  }

  getUnresolvedConflicts(projectId: string): Array<{
    id: string
    memoryAKey: string
    memoryBKey: string
    reason: string
    createdAt: string
  }> {
    const rows = this.db.prepare(`
      SELECT id, memory_a_key, memory_b_key, reason, created_at
      FROM memory_conflicts
      WHERE project_id = ? AND resolved = 0
      ORDER BY created_at DESC
    `).all(projectId) as Array<{
      id: string; memory_a_key: string; memory_b_key: string; reason: string; created_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      memoryAKey: r.memory_a_key,
      memoryBKey: r.memory_b_key,
      reason: r.reason,
      createdAt: r.created_at,
    }))
  }

  resolveConflict(
    conflictId: string,
    strategy: string,
    mergedValue?: string,
    resolvedBy?: string,
  ): void {
    this.db.prepare(`
      UPDATE memory_conflicts
      SET resolved = 1, resolution_strategy = ?, merged_value = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(strategy, mergedValue || null, resolvedBy || null, conflictId)
  }

  // --- T2: Scored query for unified search ranking ---

  /**
   * Query memories returning both semantic and text scores for the ranker.
   */
  scoredQuery(
    projectId: string,
    query: string,
    queryEmbedding: number[] | null,
    type?: MemoryType,
    limit = 5,
  ): Array<{ memory: Memory; semanticScore: number; textScore: number }> {
    const results: Array<{ memory: Memory; semanticScore: number; textScore: number }> = []
    const seen = new Set<string>()

    // Semantic pass
    if (queryEmbedding) {
      let sql = "SELECT * FROM memories WHERE project_id = ? AND status = 'live' AND embedding IS NOT NULL"
      const params: unknown[] = [projectId]
      if (type) { sql += ' AND type = ?'; params.push(type) }
      const rows = this.db.prepare(sql).all(...params) as (SqliteMemoryRow & { embedding: string | null })[]
      for (const row of rows) {
        if (!row.embedding) continue
        const emb = JSON.parse(row.embedding) as number[]
        const sim = cosineSimilarity(queryEmbedding, emb)
        if (sim > 0.3) {
          seen.add(row.id)
          results.push({ memory: rowToMemory(row), semanticScore: sim, textScore: 0 })
        }
      }
    }

    // Text pass
    const pattern = `%${query}%`
    let sql = `SELECT * FROM memories WHERE project_id = ? AND status = 'live' AND (key LIKE ? OR value LIKE ?)`
    const params: unknown[] = [projectId, pattern, pattern]
    if (type) { sql += ' AND type = ?'; params.push(type) }
    sql += ` ORDER BY updated_at DESC LIMIT ?`
    params.push(limit * 2)
    const textRows = this.db.prepare(sql).all(...params) as SqliteMemoryRow[]
    for (const row of textRows) {
      if (seen.has(row.id)) {
        // Boost existing semantic result with text score
        const existing = results.find(r => r.memory.id === row.id)
        if (existing) existing.textScore = 1.0
      } else {
        seen.add(row.id)
        results.push({ memory: rowToMemory(row), semanticScore: 0, textScore: 1.0 })
      }
    }

    return results
  }

  // --- T3: Conflict with base value ---

  getConflictWithBase(conflictId: string): {
    id: string
    projectId: string
    memoryAKey: string
    memoryBKey: string
    reason: string
    resolved: boolean
    mergeBaseValue: string | null
  } | null {
    const row = this.db.prepare(
      'SELECT * FROM memory_conflicts WHERE id = ?'
    ).get(conflictId) as {
      id: string; project_id: string; memory_a_key: string; memory_b_key: string
      reason: string; resolved: number; merge_base_value: string | null
    } | undefined
    if (!row) return null
    return {
      id: row.id,
      projectId: row.project_id,
      memoryAKey: row.memory_a_key,
      memoryBKey: row.memory_b_key,
      reason: row.reason,
      resolved: row.resolved === 1,
      mergeBaseValue: row.merge_base_value || null,
    }
  }

  setConflictBaseValue(conflictId: string, baseValue: string): void {
    this.db.prepare(
      'UPDATE memory_conflicts SET merge_base_value = ? WHERE id = ?'
    ).run(baseValue, conflictId)
  }

  // --- T4: Batch getByKeys for multi-hop recall ---

  getByKeys(projectId: string, keys: string[]): Memory[] {
    if (keys.length === 0) return []
    const placeholders = keys.map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT * FROM memories WHERE project_id = ? AND key IN (${placeholders})`
    ).all(projectId, ...keys) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  // --- T5: Field-level change tracking ---

  addFieldChange(
    versionId: string,
    memoryId: string,
    projectId: string,
    fieldName: string,
    oldValue: unknown,
    newValue: unknown,
    changeType: 'added' | 'removed' | 'modified',
  ): void {
    this.db.prepare(`
      INSERT INTO field_changes (id, version_id, memory_id, project_id, field_name, old_value, new_value, change_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      _randomUUID(),
      versionId,
      memoryId,
      projectId,
      fieldName,
      oldValue !== undefined && oldValue !== null ? JSON.stringify(oldValue) : null,
      newValue !== undefined && newValue !== null ? JSON.stringify(newValue) : null,
      changeType,
    )
  }

  getFieldChanges(memoryId: string): Array<{
    versionId: string
    fieldName: string
    oldValue: unknown
    newValue: unknown
    changeType: string
    createdAt: string
  }> {
    const rows = this.db.prepare(`
      SELECT version_id, field_name, old_value, new_value, change_type, created_at
      FROM field_changes WHERE memory_id = ?
      ORDER BY created_at DESC
    `).all(memoryId) as Array<{
      version_id: string; field_name: string; old_value: string | null
      new_value: string | null; change_type: string; created_at: string
    }>
    return rows.map(r => ({
      versionId: r.version_id,
      fieldName: r.field_name,
      oldValue: r.old_value ? JSON.parse(r.old_value) : null,
      newValue: r.new_value ? JSON.parse(r.new_value) : null,
      changeType: r.change_type,
      createdAt: r.created_at,
    }))
  }

  // --- T6: Access time tracking for decay ---

  updateAccessTime(memoryId: string): void {
    this.db.prepare(`
      UPDATE memories SET last_accessed_at = datetime('now'), access_count = access_count + 1
      WHERE id = ?
    `).run(memoryId)
  }

  getAccessInfo(memoryId: string): { lastAccessedAt: string | null; accessCount: number } | null {
    const row = this.db.prepare(
      'SELECT last_accessed_at, access_count FROM memories WHERE id = ?'
    ).get(memoryId) as { last_accessed_at: string | null; access_count: number } | undefined
    if (!row) return null
    return { lastAccessedAt: row.last_accessed_at, accessCount: row.access_count }
  }

  getAccessCounts(projectId: string): Map<string, number> {
    const rows = this.db.prepare(
      'SELECT id, access_count FROM memories WHERE project_id = ?'
    ).all(projectId) as Array<{ id: string; access_count: number }>
    const counts = new Map<string, number>()
    for (const row of rows) {
      counts.set(row.id, row.access_count)
    }
    return counts
  }

  getStaleMemories(projectId: string, olderThanDays: number, maxAccessCount = 2): Memory[] {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE project_id = ? AND status = 'live'
        AND updated_at < ?
        AND (last_accessed_at IS NULL OR last_accessed_at < ?)
        AND access_count <= ?
    `).all(projectId, cutoff, cutoff, maxAccessCount) as SqliteMemoryRow[]
    return rows.map(rowToMemory)
  }

  archiveMemory(memoryId: string): void {
    this.db.prepare(
      `UPDATE memories SET status = 'archived', dirty = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(memoryId)
  }

  // --- T7: Session branch operations ---

  createBranch(branch: { id: string; sessionId: string; projectId: string; parentBranch: string | null; createdAt: string }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_branches (id, session_id, project_id, parent_branch, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(branch.id, branch.sessionId, branch.projectId, branch.parentBranch || null, branch.createdAt)
  }

  upsertMemoryInBranch(sessionId: string, memory: Memory, dirty = true): void {
    this.db.prepare(`
      INSERT INTO branch_memories (id, session_id, project_id, memory_key, memory_data, dirty, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id, memory_key) DO UPDATE SET
        memory_data = excluded.memory_data,
        dirty = excluded.dirty,
        updated_at = datetime('now')
    `).run(
      _randomUUID(),
      sessionId,
      memory.projectId,
      memory.key,
      JSON.stringify(memory),
      dirty ? 1 : 0,
    )
  }

  getBranchMemories(sessionId: string): Memory[] {
    const rows = this.db.prepare(
      `SELECT memory_data FROM branch_memories WHERE session_id = ?`
    ).all(sessionId) as Array<{ memory_data: string }>
    return rows.map(r => JSON.parse(r.memory_data) as Memory)
  }

  deleteBranch(sessionId: string): void {
    this.db.prepare('DELETE FROM branch_memories WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM memory_branches WHERE session_id = ?').run(sessionId)
  }

  queryMemoriesInBranch(sessionId: string, query: string, type?: MemoryType, limit = 5): Memory[] {
    const pattern = `%${query}%`
    const rows = this.db.prepare(`
      SELECT memory_data FROM branch_memories
      WHERE session_id = ? AND (memory_key LIKE ? OR memory_data LIKE ?)
      LIMIT ?
    `).all(sessionId, pattern, pattern, limit) as Array<{ memory_data: string }>
    let mems = rows.map(r => JSON.parse(r.memory_data) as Memory)
    if (type) mems = mems.filter(m => m.type === type)
    return mems.slice(0, limit)
  }

  // --- T8: Token index for full-text search ---

  indexMemoryTokens(memoryId: string, projectId: string, tokens: string[]): void {
    // Remove old token entries for this memory
    this.db.prepare('DELETE FROM token_index WHERE memory_id = ?').run(memoryId)
    const insert = this.db.prepare(`
      INSERT INTO token_index (id, memory_id, project_id, token, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertMany = this.db.transaction((tkns: string[]) => {
      for (let i = 0; i < tkns.length; i++) {
        insert.run(_randomUUID(), memoryId, projectId, tkns[i], i)
      }
    })
    insertMany(tokens)
  }

  searchTokenIndex(projectId: string, tokens: string[], limit = 5): Array<{ memoryId: string; score: number }> {
    if (tokens.length === 0) return []
    const placeholders = tokens.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT memory_id, COUNT(*) as hit_count
      FROM token_index
      WHERE project_id = ? AND token IN (${placeholders})
      GROUP BY memory_id
      ORDER BY hit_count DESC
      LIMIT ?
    `).all(projectId, ...tokens, limit) as Array<{ memory_id: string; hit_count: number }>

    return rows.map(r => ({
      memoryId: r.memory_id,
      score: r.hit_count / tokens.length,
    }))
  }

  countMemories(projectId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM memories WHERE project_id = ? AND status = ?'
    ).get(projectId, 'live') as { count: number }
    return row.count
  }

  close(): void {
    this.db.close()
  }

  // --- XL1: Dedup log ---

  logDedupConsolidation(
    projectId: string,
    survivorKey: string,
    victimKey: string,
    mergeNote: string,
  ): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dedup_log (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          survivor_key TEXT NOT NULL,
          victim_key TEXT NOT NULL,
          merge_note TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS dl_project ON dedup_log(project_id);
      `)
    } catch { /* already exists */ }
    this.db.prepare(`
      INSERT INTO dedup_log (id, project_id, survivor_key, victim_key, merge_note)
      VALUES (?, ?, ?, ?, ?)
    `).run(_randomUUID(), projectId, survivorKey, victimKey, mergeNote)
  }

  getDedupLog(projectId: string): Array<{
    id: string
    survivorKey: string
    victimKey: string
    mergeNote: string
    createdAt: string
  }> {
    try {
      const rows = this.db.prepare(
        'SELECT id, survivor_key, victim_key, merge_note, created_at FROM dedup_log WHERE project_id = ? ORDER BY created_at DESC'
      ).all(projectId) as Array<{ id: string; survivor_key: string; victim_key: string; merge_note: string; created_at: string }>
      return rows.map(r => ({
        id: r.id,
        survivorKey: r.survivor_key,
        victimKey: r.victim_key,
        mergeNote: r.merge_note,
        createdAt: r.created_at,
      }))
    } catch { return [] }
  }

  // --- XL5: Template fill log ---

  logTemplateFill(projectId: string, templateId: string, memoryKey: string): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS template_fills (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          template_id TEXT NOT NULL,
          memory_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS tf_project ON template_fills(project_id);
      `)
    } catch { /* already exists */ }
    this.db.prepare(`
      INSERT INTO template_fills (id, project_id, template_id, memory_key)
      VALUES (?, ?, ?, ?)
    `).run(_randomUUID(), projectId, templateId, memoryKey)
  }

  getTemplateFills(projectId: string): Array<{
    templateId: string
    memoryKey: string
    createdAt: string
  }> {
    try {
      const rows = this.db.prepare(
        'SELECT template_id, memory_key, created_at FROM template_fills WHERE project_id = ? ORDER BY created_at DESC'
      ).all(projectId) as Array<{ template_id: string; memory_key: string; created_at: string }>
      return rows.map(r => ({ templateId: r.template_id, memoryKey: r.memory_key, createdAt: r.created_at }))
    } catch { return [] }
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
  status: string
  conditions: string | null
  phases: string | null
  cross_system_refs: string | null
  examples: string | null
  execution_flow: string | null
  verified_at: string | null
  encrypted: number
}

function rowToMemory(row: SqliteMemoryRow): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    value: row.value,
    type: row.type as MemoryType,
    source: row.source as MemorySource,
    status: (row.status || 'live') as MemoryStatus,
    agentName: row.agent_name || undefined,
    filePaths: JSON.parse(row.file_paths),
    tags: JSON.parse(row.tags),
    confidence: row.confidence,
    conditions: row.conditions ? JSON.parse(row.conditions) : undefined,
    phases: row.phases ? JSON.parse(row.phases) : undefined,
    crossSystemRefs: row.cross_system_refs ? JSON.parse(row.cross_system_refs) : undefined,
    examples: row.examples ? JSON.parse(row.examples) : undefined,
    executionFlow: row.execution_flow ? JSON.parse(row.execution_flow) : undefined,
    verifiedAt: row.verified_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    encrypted: row.encrypted === 1,
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
