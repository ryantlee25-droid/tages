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
            const result = this.cache.hydrateFromRemote(memories)
            // Only advance the watermark when everything was applied. A row
            // skipped to protect an unsynced local edit is still pending, and
            // moving `last_synced_at` past it would push that revision outside
            // every future `updated_at > lastSynced` window — the local copy of
            // that key could then never be refreshed again, silently, because
            // the "cache is current" fast path would report it up to date
            // forever. Holding the watermark costs one redundant delta query.
            if (!result?.skipped?.length) {
              this.cache.setLastSyncedAt(this.projectId, new Date().toISOString(), this.cache.getMemoryCount(this.projectId))
            } else {
              console.error(
                `[tages] Held sync watermark: ${result.skipped.length} remote update(s) deferred behind unsynced local edits`,
              )
            }
            return result?.applied ?? memories.length
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
        const result = this.cache.hydrateFromRemote(memories)
        // Same watermark rule as the delta path above.
        if (!result?.skipped?.length) {
          this.cache.setLastSyncedAt(this.projectId, new Date().toISOString(), memories.length)
        } else {
          console.error(
            `[tages] Held sync watermark: ${result.skipped.length} remote update(s) deferred behind unsynced local edits`,
          )
        }
        return result?.applied ?? memories.length
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
    await this._flushMemories()
    await this._flushDirtyChunks()
  }

  private async _flushMemories(): Promise<void> {
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
   * Push any locally-dirty chunk sets (Task 9) to Supabase. This is what
   * makes the CLI's durable, awaited write path actually reach the remote
   * `memory_chunks` table: `remember.ts` only has `cache` + `flush()`, not a
   * direct `SupabaseSync` reference, so chunk rows ride the same dirty-flag +
   * flush() mechanism the pooled embedding/memory row already uses rather
   * than a separate remote call site.
   */
  private async _flushDirtyChunks(): Promise<void> {
    const groups = this.cache.getDirtyChunkGroups()
    for (const { memoryId, projectId } of groups) {
      // Resolve the local row's (project_id, key) — remoteUpsertChunks is
      // keyed on the business key, not the (divergent) local id.
      const local = this.cache.getKeyById(memoryId)
      if (!local) {
        // Fix F(b): the parent memory is gone locally (forgotten/deleted), so
        // these chunk rows are orphans that will never resolve. Delete them
        // instead of skipping forever (which left them dirty=1 and re-scanned
        // every flush, wasting work and storage).
        this.cache.deleteChunksForMemory(memoryId)
        continue
      }
      // Fix C: capture the SPECIFIC dirty chunk row ids at flush time and clear
      // dirty only for those after the round-trip. A concurrent v2 chunk write
      // (upsertChunks delete-then-insert => fresh ids, dirty=1) landing during
      // the network await below keeps its own dirty flag and syncs next cycle,
      // instead of being clobbered by a memory-wide markChunksSynced(memoryId).
      const dirtyRows = this.cache.getDirtyChunkRows(memoryId)
      const chunks = dirtyRows.map((r) => ({ text: r.text, embedding: r.embedding }))
      const ok = await this.remoteUpsertChunks(projectId, local.key, chunks)
      if (ok) this.cache.markChunksSynced(dirtyRows.map((r) => r.id))
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

  /**
   * Narrow, embedding-only remote update keyed by (project_id, key).
   *
   * Routed through the same `enqueue` serialisation queue as remoteInsert's
   * dirty flush and remoteDelete, so the late-resolving embedding write is
   * ordered against concurrent writes and deletes. Crucially this is an
   * `.update()` (not `.upsert()`): it sets ONLY the `embedding` column and
   * is a no-op when no row matches (the key was `forget`-deleted between the
   * original write and now) — it never re-creates a deleted row and never
   * clobbers a newer value written by a concurrent remember(key, V2).
   */
  async remoteUpdateEmbedding(projectId: string, key: string, embedding: number[]): Promise<boolean> {
    return this.enqueue(() => this._remoteUpdateEmbedding(projectId, key, embedding))
  }

  private async _remoteUpdateEmbedding(projectId: string, key: string, embedding: number[]): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memories')
        .update({ embedding: embeddingToPgVector(embedding) })
        .eq('project_id', projectId)
        .eq('key', key)
      if (error) {
        console.error('[tages] Remote embedding update failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Replace all remote chunk rows for a memory (delete-then-insert by
   * memory_id, mirroring SqliteCache.upsertChunks's local semantics). Not
   * routed through `enqueue` — it's called either directly from a
   * fire-and-forget embedding job (server write path) or from inside
   * `_flushDirtyChunks`, which already runs inside `enqueue`'s serialized
   * queue via `flush()`.
   *
   * Race guard (Task 9 pre-mortem): this can resolve seconds after the
   * original write (fire-and-forget), or run during a later flush cycle, so
   * the parent memory may have been `forget`-deleted in the meantime.
   * Deleting the old chunk set and blindly re-inserting a fresh one against a
   * `memory_id` that no longer exists would violate the `memory_id` foreign
   * key (loud failure) — or, if that id were ever reused by an unrelated row,
   * would silently attach chunks to the WRONG memory (a much worse, silent
   * failure). So the parent's existence is re-checked immediately before the
   * insert half rather than relied upon via the FK: on a torn-down parent,
   * this returns false (nothing inserted, chunks stay deleted) instead of
   * surfacing an FK error or risking a misattached row.
   *
   * Known limitation, not fixed here (out of this task's file ownership):
   * `remoteInsert` above always excludes `id` from the upsert payload, so a
   * memory's authoritative Supabase row id can differ from the locally
   * generated `memory.id` a caller passes in here — see this task's PR notes.
   * When that happens, the parent-exists check below simply finds no match
   * and this fails open (logged, no chunks written) rather than corrupting
   * data; the caller's pooled-embedding write is entirely unaffected either
   * way.
   */
  async remoteUpsertChunks(
    projectId: string,
    key: string,
    chunks: Array<{ text: string; embedding: number[] }>,
  ): Promise<boolean> {
    try {
      // Keyed on (project_id, key), NOT a memory id: remote memory upserts
      // strip the local id (Supabase keeps/assigns its own), so a locally
      // generated uuid routinely differs from the remote row's real id for
      // every CLI-written memory. Keying the delete/insert on a local id
      // silently no-ops (delete matches nothing, parent check finds
      // nothing), stranding all chunks locally: caught live on the dev
      // eval, 42 local chunk rows / 0 remote. Same id-divergence class as
      // PR #70's embedding-update bug; same fix (resolve via project+key).
      // This resolution doubles as the concurrent-parent-delete race guard.
      const { data: parent, error: parentError } = await this.supabase
        .from('memories')
        .select('id')
        .eq('project_id', projectId)
        .eq('key', key)
        .maybeSingle()
      if (parentError) {
        console.error('[tages] Remote chunk parent resolve failed:', parentError.message)
        return false
      }
      if (!parent) {
        console.error(`[tages] Remote chunk sync skipped: parent memory "${key}" not on remote yet (or deleted)`)
        return false
      }
      const remoteMemoryId = (parent as { id: string }).id

      const { error: deleteError } = await this.supabase
        .from('memory_chunks')
        .delete()
        .eq('memory_id', remoteMemoryId)
      if (deleteError) {
        console.error('[tages] Remote chunk delete failed:', deleteError.message)
        return false
      }

      if (chunks.length === 0) return true

      const rows = chunks.map((chunk, index) => ({
        memory_id: remoteMemoryId,
        project_id: projectId,
        chunk_index: index,
        chunk_text: chunk.text,
        embedding: embeddingToPgVector(chunk.embedding),
      }))
      const { error: insertError } = await Promise.resolve(
        this.supabase.from('memory_chunks').insert(rows),
      )
      if (insertError) {
        console.error('[tages] Remote chunk insert failed:', insertError.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[tages] Remote chunk upsert error:', (err as Error).message)
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
      const embeddingStr = embeddingToPgVector(embedding)
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

  /**
   * Chunk-level semantic recall (PLAN.md Task 11): calls the
   * `chunk_semantic_recall` RPC (migration 0064), which matches against
   * per-chunk embeddings and rolls up to one row per parent memory (its
   * best-matching chunk). Mirrors `remoteHybridRecall`'s shape; the RPC's
   * extra chunk_index/chunk_text columns are dropped by dbRowToMemory —
   * the parent memory's full value is what the MCP tool returns.
   */
  async remoteChunkSemanticRecall(
    embedding: number[],
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const embeddingStr = embeddingToPgVector(embedding)
      const { data, error } = await this.supabase.rpc('chunk_semantic_recall', {
        p_project_id: this.projectId,
        p_embedding: embeddingStr,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Chunk semantic recall failed:', error.message)
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

  /**
   * Promote a remote memory to `status='live'`, keyed by (project_id, key).
   *
   * NOT keyed by the memory's local id. `remoteInsert` / `_flushMemories`
   * strip `id` from the upsert payload and conflict on `project_id,key`, so
   * Supabase assigns its own uuid while the local SQLite row keeps the
   * `randomUUID()` it was created with. For every memory written through this
   * client those two ids differ, so `.eq('id', localId)` matched zero rows and
   * this silently no-opped: the remote row stayed `pending`, and since every
   * recall path filters `status='live'`, no teammate ever saw the promotion.
   *
   * Same id-divergence bug class as PR #70's embedding update and the chunk
   * sync bug; same fix — resolve the row by its business key, which is exactly
   * the upsert's conflict target.
   *
   * This is an `.update()`, never an `.upsert()`: a non-matching row is a
   * no-op, so a `forget`-deleted memory is never resurrected.
   */
  async remoteVerifyMemory(projectId: string, key: string, verifiedAt: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memories')
        .update({ status: 'live', verified_at: verifiedAt })
        .eq('project_id', projectId)
        .eq('key', key)
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
  referenced_date: string | null
  relative_date: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  encrypted: boolean
  // Optional (not `| null`) and deliberately omitted from the row object when
  // the in-memory Memory has no embedding yet: Supabase's `.upsert()` only
  // updates columns present in the payload, so omitting the key on a
  // conflict-update leaves any already-synced embedding untouched instead of
  // clobbering it with null. See memoryToDbRow below.
  embedding?: string
}

/** Serialize a raw embedding vector into the pgvector literal format Supabase expects. */
export function embeddingToPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/** Parse a pgvector literal (or Supabase's string representation of one) back into a number array. */
export function pgVectorToEmbedding(value: string): number[] {
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!trimmed) return []
  return trimmed.split(',').map(Number)
}

export function dbRowToMemory(row: DbRow): Memory {
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
    referencedDate: row.referenced_date || undefined,
    relativeDate: row.relative_date || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || undefined,
    updatedBy: row.updated_by || undefined,
    encrypted: row.encrypted || false,
    embedding: row.embedding ? pgVectorToEmbedding(row.embedding) : undefined,
  }
}

export function memoryToDbRow(memory: Memory): DbRow {
  const row: DbRow = {
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
    referenced_date: memory.referencedDate || null,
    relative_date: memory.relativeDate || null,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    created_by: memory.createdBy || null,
    updated_by: memory.updatedBy || null,
    encrypted: memory.encrypted || false,
  }
  // Only set the column when we actually have an embedding. Leaving the key
  // off entirely (rather than setting it to null) means a sync that races
  // ahead of embedding generation can't stomp a previously-computed embedding.
  if (memory.embedding && memory.embedding.length > 0) {
    row.embedding = embeddingToPgVector(memory.embedding)
  }
  return row
}
