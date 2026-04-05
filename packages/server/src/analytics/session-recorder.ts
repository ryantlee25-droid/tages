export interface ToolCallRecord {
  toolName: string
  args: Record<string, unknown>
  resultSummary: string
  durationMs: number
  timestamp: string
}

export interface SessionRecord {
  sessionId: string
  projectId: string
  agentName?: string
  startedAt: string
  endedAt?: string
  toolCalls: ToolCallRecord[]
  metrics?: SessionMetrics
}

export interface SessionMetrics {
  totalCalls: number
  recallHits: number
  recallMisses: number
  memoriesCreated: number
  memoriesUpdated: number
  conventionViolations: number
  durationMs: number
  recallHitRate: number
  createToVerifyRatio: number
}

export class SessionRecorder {
  private sessions: Map<string, SessionRecord> = new Map()
  private currentSessionId: string | null = null

  startSession(sessionId: string, projectId: string, agentName?: string): void {
    const record: SessionRecord = {
      sessionId,
      projectId,
      agentName,
      startedAt: new Date().toISOString(),
      toolCalls: [],
    }
    this.sessions.set(sessionId, record)
    this.currentSessionId = sessionId
  }

  recordToolCall(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    resultSummary: string,
    durationMs: number,
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.toolCalls.push({
      toolName,
      args,
      resultSummary,
      durationMs,
      timestamp: new Date().toISOString(),
    })
  }

  endSession(sessionId: string): SessionRecord | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    session.endedAt = new Date().toISOString()
    session.metrics = this.computeMetrics(session)
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null
    }
    return session
  }

  getSession(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId) || null
  }

  getAllSessions(projectId: string): SessionRecord[] {
    return [...this.sessions.values()].filter(s => s.projectId === projectId)
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId
  }

  private computeMetrics(session: SessionRecord): SessionMetrics {
    const calls = session.toolCalls
    const recallCalls = calls.filter(c => c.toolName === 'recall' || c.toolName === 'contextual_recall')
    const recallHits = recallCalls.filter(c => !c.resultSummary.includes('No memories found')).length
    const recallMisses = recallCalls.length - recallHits

    const memoriesCreated = calls.filter(c => c.toolName === 'remember' && c.resultSummary.includes('Stored')).length
    const memoriesUpdated = calls.filter(c => c.toolName === 'remember' && c.resultSummary.includes('Updated')).length
    const conventionViolations = calls.filter(c => c.resultSummary.toLowerCase().includes('violation')).length

    const start = new Date(session.startedAt).getTime()
    const end = session.endedAt ? new Date(session.endedAt).getTime() : Date.now()
    const durationMs = end - start

    const recallHitRate = recallCalls.length > 0 ? recallHits / recallCalls.length : 0
    const verifyCalls = calls.filter(c => c.toolName === 'verify_memory').length
    const createToVerifyRatio = verifyCalls > 0 ? memoriesCreated / verifyCalls : memoriesCreated

    return {
      totalCalls: calls.length,
      recallHits,
      recallMisses,
      memoriesCreated,
      memoriesUpdated,
      conventionViolations,
      durationMs,
      recallHitRate,
      createToVerifyRatio,
    }
  }
}

// Global singleton
export const globalSessionRecorder = new SessionRecorder()
