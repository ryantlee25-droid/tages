import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'

const SYNC_INTERVAL_MS = 60_000

export class SupabaseSync {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private supabase: SupabaseClient,
    private cache: SqliteCache,
    private projectId: string,
  ) {}

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
    const dirty = this.cache.getDirty()
    if (dirty.length === 0) return

    try {
      const rows = dirty.map(memoryToDbRow)
      const { error } = await this.supabase
        .from('memories')
        .upsert(rows, { onConflict: 'project_id,key' })

      if (error) {
        console.error('[tages] Sync flush failed:', error.message)
        return
      }

      this.cache.markSynced(dirty.map(m => m.id))
    } catch (err) {
      console.error('[tages] Sync error:', (err as Error).message)
    }
  }

  async remoteInsert(memory: Memory): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memories')
        .upsert(memoryToDbRow(memory), { onConflict: 'project_id,key' })

      if (error) {
        console.error('[tages] Remote insert failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  async remoteDelete(projectId: string, key: string): Promise<boolean> {
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
  }
}
