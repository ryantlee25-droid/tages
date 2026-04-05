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

  async hydrate(): Promise<number> {
    try {
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

  async remoteGetByType(type: string): Promise<Memory[] | null> {
    try {
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('project_id', this.projectId)
        .eq('type', type)
        .order('updated_at', { ascending: false })

      if (error) return null
      return (data || []).map(dbRowToMemory)
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
  agent_name: string | null
  file_paths: string[]
  tags: string[]
  confidence: number
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
    agentName: row.agent_name || undefined,
    filePaths: row.file_paths || [],
    tags: row.tags || [],
    confidence: row.confidence,
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
    agent_name: memory.agentName || null,
    file_paths: memory.filePaths || [],
    tags: memory.tags || [],
    confidence: memory.confidence,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
  }
}
