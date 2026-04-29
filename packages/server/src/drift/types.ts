/**
 * Drift — Agent Stability Index (ASI)-inspired metrics for coding teams.
 *
 * v1 ships one real metric (semantic) and two stubs (coordination, behavioral)
 * behind an "experimental" label. Full metric set tracked in PLAN.md §3.3;
 * methodology based on arxiv:2601.04170 (Agent Stability Index).
 */

export interface FieldChangeRow {
  memory_id: string
  memory_key?: string | null
  project_id: string
  field_name: string
  old_value: unknown
  new_value: unknown
  change_type: 'added' | 'removed' | 'modified'
  created_at: string
  // From join with memories row:
  session_id?: string | null
  agent_name?: string | null
}

export interface ToolCallRow {
  project_id: string
  session_id: string
  agent_name: string | null
  tool_name: string
  created_at: string
}

export interface DriftInput {
  projectId: string
  /** ISO timestamp — only consider activity at or after this time. */
  since?: string
  /**
   * Behavioral-drift baseline window start (ISO). Window A spans
   * [baselineSince, currentSince). Optional; if absent, behavioral drift
   * falls back to a midpoint split of the available tool-call data.
   */
  baselineSince?: string
  /**
   * Behavioral-drift current window start (ISO). Window B spans
   * [currentSince, max(toolCall.created_at)]. Optional; see baselineSince.
   */
  currentSince?: string
  /** If set, only consider changes / calls by this agent_name. */
  agentFilter?: string
  fieldChanges: FieldChangeRow[]
  toolCalls: ToolCallRow[]
}

export interface SemanticDriftKeyReport {
  memoryKey: string
  distinctValues: number
  totalChanges: number
  instability: number // 0..1
  sessions: string[]
  agents: string[]
}

export interface SemanticDriftReport {
  score: number // 0..1, mean instability across keys with drift signal
  keysExamined: number
  keysWithDrift: number
  topKeys: SemanticDriftKeyReport[]
}

export interface MetricStub {
  score: number
  status: 'not_implemented' | 'insufficient_data' | 'ok'
  note: string
}

export interface AgentToolDistribution {
  agent: string
  callCount: number
  /** Top 3 tools by share of this agent's calls in the current window. */
  topTools: { tool: string; share: number }[]
}

export interface BehavioralWindow {
  since: string
  until: string
  toolCallCount: number
}

/**
 * Behavioral drift superset of MetricStub. Old callers reading `score`,
 * `status`, `note` continue to work; new fields (`jsd`, `agentCount`,
 * `agentDistributions`, `windowA`, `windowB`) appear when status === 'ok'.
 */
export interface BehavioralDriftReport {
  score: number
  status: 'not_implemented' | 'insufficient_data' | 'ok'
  note: string
  jsd?: number
  agentCount?: number
  agentDistributions?: AgentToolDistribution[]
  windowA?: BehavioralWindow
  windowB?: BehavioralWindow
}

export interface DriftReport {
  projectId: string
  window: { since?: string; generatedAt: string }
  agentFilter?: string
  experimental: true
  driftScore: number // 0..1, overall weighted
  weights: { semantic: number; coordination: number; behavioral: number }
  semantic: SemanticDriftReport
  coordination: MetricStub
  behavioral: BehavioralDriftReport
}
