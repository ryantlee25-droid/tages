import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import { SyncWAL } from '../cache/sync-wal'

const SYNC_INTERVAL_MS = 60_000

export class SupabaseSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private wal: SyncWAL | null = null
  /** Simple promise-chain mutex to prevent flush() racing with remoteDelete(). */
  private flushQueue: Promise<void> = Promise.resolve()

  constructor(
    private supabase: SupabaseClient,
    private cache: SqliteCache,
    private projectId: string,
    walPath?: string,
  ) {
    if (walPath) {
      this.wal = new SyncWAL(walPath)
    }
  }

  /** Enqueue work on the flush serialisation queue (prevents resurrection races). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.flushQueue.then(fn)
    // Keep the queue moving even if this task throws
    this.flushQueue = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Recover any incomplete WAL operations from a previous crash.
   * Should be called on startup before hydration.
   */
  async recoverWAL(): Promise<number> {
    if (!this.wal) return 0
    const incomplete = this.wal.getIncomplete()
    if (incomplete.length === 0) return 0

    console.error(`[tages] WAL recovery: replaying ${incomplete.length} incomplete operations`)
    let recovered = 0

    for (const op of incomplete) {
      try {
        if (op.operation === 'upsert') {
          const memory = JSON.parse(op.payload) as Memory
          const { id: _id, ...rowWithoutId } = memoryToDbRow(memory)
          const { error } = await this.supabase
            .from('memories')
            .upsert(rowWithoutId, { onConflict: 'project_id,key' })
          if (!error) {
            this.wal.markComplete(op.id)
            recovered++
          }
        } else if (op.operation === 'delete') {
          const key = JSON.parse(op.payload) as string
          const { error } = await this.supabase
            .from('memories')
            .delete()
            .eq('project_id', op.projectId)
            .eq('key', key)
          if (!error) {
            this.wal.markComplete(op.id)
            recovered++
          }
        }
      } catch (err) {
        console.error(`[tages] WAL recovery failed for op ${op.id}:`, (err as Error).message)
      }
    }

    console.error(`[tages] WAL recovery complete: ${recovered}/${incomplete.length} recovered`)
    return recovered
  }

  /**
   * Smart hydration: checks if anything changed since last sync.
   * If no changes, skips the full pull — reads from local SQLite cache.
   * Returns number of memories synced (0 = cache was current).
   */
  async hydrate(): Promise<number> {
    try {
      const lastSynced = this.cache.getLastSyncedAt(this.projectId)
      const localCount = this.cache.getMemoryCount(this.projectId)

      // If we have a local cache, check if anything changed
      if (lastSynced && localCount > 0) {
        const { count, error: countError } = await this.supabase
          .from('memories')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', this.projectId)
          .gt('updated_at', lastSynced)

        if (!countError && count === 0) {
          // Also verify total count matches (catches deletes)
          const { count: totalCount } = await this.supabase
            .from('memories')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', this.projectId)

          if (totalCount === localCount) {
            console.error(`[tages] Cache is current (${localCount} memories, last sync: ${lastSynced})`)
            return 0
          }
        }

        // Delta sync: only pull changed memories
        if (!countError && count !== null && count > 0 && count < localCount) {
          console.error(`[tages] Delta sync: ${count} memories changed since ${lastSynced}`)
          const { data } = await this.supabase
            .from('memories')
            .select('*')
            .eq('project_id', this.projectId)
            .gt('updated_at', lastSynced)

          if (data && data.length > 0) {
            const memories: Memory[] = data.map(dbRowToMemory)
            this.cache.hydrateFromRemote(memories)
            this.cache.setLastSyncedAt(this.projectId, new Date().toISOString(), this.cache.getMemoryCount(this.projectId))
            return memories.length
          }
        }
      }

      // Full hydration (first run or cache invalid)
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('project_id', this.projectId)

      if (error) {
        console.error('[tages] Hydration failed:', error.message)
        return 0
      }

      if (data && data.length > 0) {
        const memories: Memory[] = data.map(dbRowToMemory)
        this.cache.hydrateFromRemote(memories)
        this.cache.setLastSyncedAt(this.projectId, new Date().toISOString(), memories.length)
        return memories.length
      }
      return 0
    } catch (err) {
      console.error('[tages] Hydration error:', (err as Error).message)
      return 0
    }
  }

  startSync(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.flush(), SYNC_INTERVAL_MS)
  }

  stopSync(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async flush(): Promise<void> {
    return this.enqueue(() => this._flush())
  }

  private async _flush(): Promise<void> {
    const dirty = this.cache.getDirty()
    if (dirty.length === 0) return

    // Log to WAL before remote call for crash safety
    const walIds: string[] = []
    if (this.wal) {
      for (const mem of dirty) {
        const walId = this.wal.logPending(mem.id, mem.projectId, 'upsert', memoryToDbRow(mem))
        walIds.push(walId)
      }
    }

    try {
      const rows = dirty.map(m => {
        const { id: _id, ...rest } = memoryToDbRow(m)
        return rest
      })
      const { error } = await this.supabase
        .from('memories')
        .upsert(rows, { onConflict: 'project_id,key' })

      if (error) {
        console.error('[tages] Sync flush failed:', error.message)
        return
      }

      this.cache.markSynced(dirty.map(m => m.id))

      // Mark WAL entries complete after successful sync
      if (this.wal) {
        this.wal.markCompleteByMemoryIds(dirty.map(m => m.id))
      }
    } catch (err) {
      console.error('[tages] Sync error:', (err as Error).message)
    }
  }

  /**
   * Count memories in Supabase for the project (authoritative source for tier enforcement).
   * Returns null if the query fails (fall back to local count).
   */
  async remoteCountMemories(): Promise<number | null> {
    try {
      const { count, error } = await this.supabase
        .from('memories')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', this.projectId)
      if (error) return null
      return count ?? null
    } catch {
      return null
    }
  }

  async remoteInsert(memory: Memory): Promise<boolean> {
    // Log to WAL before the remote call
    const walId = this.wal?.logPending(memory.id, memory.projectId, 'upsert', memoryToDbRow(memory))

    try {
      const { id: _id, ...rowWithoutId } = memoryToDbRow(memory)
      const { error } = await this.supabase
        .from('memories')
        .upsert(rowWithoutId, { onConflict: 'project_id,key' })

      if (error) {
        console.error('[tages] Remote insert failed:', error.message)
        return false
      }

      if (walId && this.wal) this.wal.markComplete(walId)
      return true
    } catch {
      return false
    }
  }

  async remoteDelete(projectId: string, key: string): Promise<boolean> {
    return this.enqueue(() => this._remoteDelete(projectId, key))
  }

  private async _remoteDelete(projectId: string, key: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memories')
        .delete()
        .eq('project_id', projectId)
        .eq('key', key)

      if (error) {
        console.error('[tages] Remote delete failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  async remoteRecall(
    query: string,
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const { data, error } = await this.supabase.rpc('recall_memories', {
        p_project_id: this.projectId,
        p_query: query,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Remote recall failed:', error.message)
        return null
      }

      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  async remoteHybridRecall(
    query: string,
    embedding: number[],
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const embeddingStr = `[${embedding.join(',')}]`
      const { data, error } = await this.supabase.rpc('hybrid_recall', {
        p_project_id: this.projectId,
        p_query: query,
        p_embedding: embeddingStr,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Hybrid recall failed:', error.message)
        return null
      }

      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  async remoteGetByType(type: string): Promise<Memory[] | null> {
    try {
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('project_id', this.projectId)
        .eq('type', type)
        .eq('status', 'live')
        .order('updated_at', { ascending: false })

      if (error) return null
      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  async remoteVerifyMemory(id: string, verifiedAt: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memories')
        .update({ status: 'live', verified_at: verifiedAt })
        .eq('id', id)
      if (error) {
        console.error('[tages] Remote verify failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /** Persist a federated memory promotion to Supabase. */
  async remoteFederatedInsert(row: {
    id: string
    owner_project_id: string
    memory_key: string
    memory_data: unknown
    scope: string
    version: number
    promoted_by: string | null
    promoted_at: string
  }): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('federated_memories')
        .upsert(row, { onConflict: 'memory_key,version' })
      if (error) {
        console.error('[tages] Federated insert failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /** List federated memories from Supabase, optionally filtered by scope. */
  async remoteListFederated(scope?: string): Promise<Array<{
    id: string
    owner_project_id: string
    memory_key: string
    memory_data: unknown
    scope: string
    version: number
    promoted_by: string | null
    promoted_at: string
  }> | null> {
    try {
      let query = this.supabase.from('federated_memories').select('*')
      if (scope) {
        query = query.eq('scope', scope)
      }
      const { data, error } = await query.order('promoted_at', { ascending: false })
      if (error) {
        console.error('[tages] Federated list failed:', error.message)
        return null
      }
      return data || []
    } catch {
      return null
    }
  }
}

interface DbRow {
  id: string
  project_id: string
  key: string
  value: string
  type: string
  source: string
  status: string
  agent_name: string | null
  file_paths: string[]
  tags: string[]
  confidence: number
  conditions: string[] | null
  phases: string[] | null
  cross_system_refs: string[] | null
  examples: unknown | null
  execution_flow: unknown | null
  verified_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  encrypted: boolean
}

function dbRowToMemory(row: DbRow): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    value: row.value,
    type: row.type as Memory['type'],
    source: row.source as Memory['source'],
    status: (row.status || 'live') as Memory['status'],
    agentName: row.agent_name || undefined,
    filePaths: row.file_paths || [],
    tags: row.tags || [],
    confidence: row.confidence,
    conditions: row.conditions || undefined,
    phases: row.phases || undefined,
    crossSystemRefs: row.cross_system_refs || undefined,
    examples: row.examples as Memory['examples'],
    executionFlow: row.execution_flow as Memory['executionFlow'],
    verifiedAt: row.verified_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || undefined,
    updatedBy: row.updated_by || undefined,
    encrypted: row.encrypted || false,
  }
}

function memoryToDbRow(memory: Memory): DbRow {
  return {
    id: memory.id,
    project_id: memory.projectId,
    key: memory.key,
    value: memory.value,
    type: memory.type,
    source: memory.source,
    status: memory.status || 'live',
    agent_name: memory.agentName || null,
    file_paths: memory.filePaths || [],
    tags: memory.tags || [],
    confidence: memory.confidence,
    conditions: memory.conditions || null,
    phases: memory.phases || null,
    cross_system_refs: memory.crossSystemRefs || null,
    examples: memory.examples || null,
    execution_flow: memory.executionFlow || null,
    verified_at: memory.verifiedAt || null,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    created_by: memory.createdBy || null,
    updated_by: memory.updatedBy || null,
    encrypted: memory.encrypted || false,
  }
}
