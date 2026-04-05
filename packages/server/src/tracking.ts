import type { SupabaseClient } from '@supabase/supabase-js'

export class SessionTracker {
  private sessionId: string | null = null
  private recallHits = 0
  private recallMisses = 0
  private memoriesRecalled = 0
  private memoriesStored = 0
  private memoriesDeleted = 0
  private activeBranchId: string | null = null

  constructor(
    private supabase: SupabaseClient | null,
    private projectId: string,
    private agentName: string = 'mcp-server',
  ) {}

  /**
   * Track the current branch context for this session (T7).
   */
  setBranchContext(branchId: string | null): void {
    this.activeBranchId = branchId
  }

  getBranchContext(): string | null {
    return this.activeBranchId
  }

  async startSession(): Promise<void> {
    if (!this.supabase) return

    const { data } = await this.supabase
      .from('agent_sessions')
      .insert({
        project_id: this.projectId,
        agent_name: this.agentName,
        agent_version: '0.1.0',
      })
      .select('id')
      .single()

    if (data) {
      this.sessionId = data.id
    }
  }

  async endSession(): Promise<void> {
    if (!this.supabase || !this.sessionId) return

    await this.supabase
      .from('agent_sessions')
      .update({
        session_end: new Date().toISOString(),
        memories_recalled: this.memoriesRecalled,
        memories_stored: this.memoriesStored,
        memories_deleted: this.memoriesDeleted,
        recall_hits: this.recallHits,
        recall_misses: this.recallMisses,
      })
      .eq('id', this.sessionId)
  }

  async logRecall(
    memoryIds: string[],
    query: string,
    similarities: number[],
  ): Promise<void> {
    if (memoryIds.length > 0) {
      this.recallHits++
      this.memoriesRecalled += memoryIds.length
    } else {
      this.recallMisses++
    }

    if (!this.supabase) return

    // Log each accessed memory
    const rows = memoryIds.map((id, i) => ({
      memory_id: id,
      session_id: this.sessionId,
      project_id: this.projectId,
      agent_name: this.agentName,
      access_type: 'recall',
      query,
      similarity: similarities[i] || null,
    }))

    if (rows.length > 0) {
      await this.supabase.from('memory_access_log').insert(rows)

      // Update access counts and last_accessed on memories
      for (const id of memoryIds) {
        await this.supabase.rpc('increment_access_count', { p_memory_id: id })
      }
    }
  }

  async logCreate(memoryId: string): Promise<void> {
    this.memoriesStored++
    if (!this.supabase || !this.sessionId) return

    await this.supabase.from('memory_access_log').insert({
      memory_id: memoryId,
      session_id: this.sessionId,
      project_id: this.projectId,
      agent_name: this.agentName,
      access_type: 'create',
    })
  }

  async logDelete(memoryId: string): Promise<void> {
    this.memoriesDeleted++
    if (!this.supabase || !this.sessionId) return

    await this.supabase.from('memory_access_log').insert({
      memory_id: memoryId,
      session_id: this.sessionId,
      project_id: this.projectId,
      agent_name: this.agentName,
      access_type: 'delete',
    })
  }
}
