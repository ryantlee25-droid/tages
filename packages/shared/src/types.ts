// ============================================================
// Tages — Shared Types
// ============================================================

export type MemoryType =
  | 'convention'
  | 'decision'
  | 'architecture'
  | 'entity'
  | 'lesson'
  | 'preference'
  | 'pattern'
  | 'execution'
  | 'operational'
  | 'environment'
  | 'anti_pattern'

export type MemorySource =
  | 'manual'
  | 'auto_index'
  | 'agent'
  | 'import'

export type MemoryStatus = 'live' | 'pending' | 'archived'

/**
 * How well established a claim is — distinct from `type` (what it is about),
 * `source` (how it was captured), and `confidence` (a float that conflates the
 * two).
 *
 * An agent reading `confidence: 0.8` cannot tell whether a test proved the
 * claim or a model guessed it, and those warrant opposite behaviour: act, or
 * check first. This field answers that and nothing else.
 *
 *   verified   checked against something executable — a test, a command, a file
 *   declared   asserted by a human as policy or intent; true because decided
 *   observed   seen happening once; empirical, may not generalise
 *   inferred   concluded by reasoning without a direct check — a lead, not a fact
 *   disputed   contradicted by evidence or by another memory
 *
 * `undefined` means unknown and is never inferred: memories written before this
 * existed have no assessment behind them, and inventing one is precisely the
 * failure this field prevents.
 *
 * Adapted from YAIML's evidence discipline (github.com/wirsingj/YAIML).
 */
export type EvidenceLevel = 'verified' | 'declared' | 'observed' | 'inferred' | 'disputed'

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = [
  'verified',
  'declared',
  'observed',
  'inferred',
  'disputed',
] as const

export function isEvidenceLevel(v: unknown): v is EvidenceLevel {
  return typeof v === 'string' && (EVIDENCE_LEVELS as readonly string[]).includes(v)
}

/**
 * Retrieval weight per level, applied multiplicatively to text and semantic
 * scores at rank time.
 *
 * A level that is recorded but never affects what comes back first is
 * decorative. `disputed` is demoted hardest but deliberately NOT suppressed —
 * a contradicted claim is exactly what someone re-litigating a decision needs
 * to find, so it must remain reachable, clearly labelled.
 *
 * An unknown level (pre-existing rows) scores 1.0: neither rewarded nor
 * punished for a field nobody filled in.
 */
export const EVIDENCE_WEIGHT: Record<EvidenceLevel, number> = {
  verified: 1.0,
  declared: 0.95,
  observed: 0.9,
  inferred: 0.75,
  disputed: 0.5,
}

export function evidenceWeight(level: EvidenceLevel | undefined | null): number {
  return level ? EVIDENCE_WEIGHT[level] : 1.0
}

export interface MemoryExample {
  input: string
  output: string
  note?: string
}

export interface ExecutionFlow {
  trigger: string
  steps: string[]
  phases?: string[]
  hooks?: string[]
}

export interface Memory {
  id: string
  projectId: string
  key: string
  value: string
  type: MemoryType
  source: MemorySource
  status: MemoryStatus
  agentName?: string
  filePaths?: string[]
  tags?: string[]
  confidence: number
  /** How well established the claim is. Undefined means unknown, never assumed. */
  evidence?: EvidenceLevel
  // Structured metadata (optional — enriches recall quality)
  conditions?: string[]
  phases?: string[]
  crossSystemRefs?: string[]
  examples?: MemoryExample[]
  executionFlow?: ExecutionFlow
  verifiedAt?: string
  // Temporal anchoring (migration 0060) — up to two additional dates beyond
  // `createdAt` (the observation date). `referencedDate` is an absolute date
  // explicitly mentioned in the memory's text (e.g. "shipped July 9, 2026");
  // `relativeDate` is a relative expression ("3 days ago", "last Tuesday")
  // resolved to an absolute timestamp against `createdAt`. Both optional and
  // populated at write time by extractDates(); recall uses the fallback chain
  // referencedDate ?? relativeDate ?? createdAt for temporal-query ordering.
  referencedDate?: string
  relativeDate?: string
  createdAt: string
  updatedAt: string
  encrypted?: boolean
  createdBy?: string
  updatedBy?: string
  // Provenance (migration 0057) — traces which agent session and tool wrote this memory
  sessionId?: string
  toolName?: string
  sourceContext?: MemorySourceContext
  // Semantic search vector (1536-dim, pgvector). Always generated from
  // pre-encryption plaintext — never from ciphertext. Optional: populated
  // asynchronously after write, so it may be absent on freshly-read rows.
  embedding?: number[]
}

export interface MemorySourceContext {
  filePath?: string
  prNumber?: number
  commitSha?: string
  ticketId?: string
  url?: string
  // Free-form for tool-specific metadata not covered by the fields above
  extra?: Record<string, unknown>
}

export interface MemoryProvenance {
  memoryId: string
  userId?: string
  userDisplay: string
  agentName?: string
  sessionId?: string
  toolName?: string
  sourceContext?: MemorySourceContext
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  name: string
  slug: string
  ownerId: string
  gitRemote?: string
  defaultBranch: string
  createdAt: string
  updatedAt: string
}

export interface DecisionLogEntry {
  id: string
  projectId: string
  decision: string
  rationale?: string
  filesAffected?: string[]
  agentName?: string
  commitSha?: string
  createdAt: string
}

export interface ArchitectureSnapshot {
  id: string
  projectId: string
  snapshot: {
    modules: Array<{ name: string; path: string; exports: string[] }>
    dependencies: Array<{ from: string; to: string }>
    boundaries: Array<{ name: string; paths: string[]; description: string }>
  }
  commitSha?: string
  createdAt: string
}

export interface TeamMember {
  id: string
  projectId: string
  userId: string | null
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'active' | 'revoked'
  invitedBy?: string
  invitedAt?: string
  createdAt: string
}

export interface UserProfile {
  userId: string
  isPro: boolean
  proSince?: string
}

// MCP tool input types
export interface RememberInput {
  key: string
  value: string
  type: MemoryType
  project?: string
  filePaths?: string[]
  tags?: string[]
  conditions?: string[]
  phases?: string[]
  crossSystemRefs?: string[]
  examples?: MemoryExample[]
  executionFlow?: ExecutionFlow
}

export interface RecallInput {
  query: string
  project?: string
  type?: MemoryType
  limit?: number
}

export interface ForgetInput {
  key: string
  project?: string
}

export interface ContextInput {
  filePath: string
  project?: string
}

// ============================================================
// Instrumented harness (Claude Code hooks + future sibling harnesses)
// ============================================================

/** Which coding-agent harness produced this event. Extension point for
 * future sibling packages (Cursor/Codex/Gemini) — each would emit
 * HarnessEvent[] tagged with its own source string. */
export type HarnessSource = 'claude_code_hook' | (string & {})

/** Normalized cross-harness event type. Wider than the `harness_tool_events`
 * table's `event_type` column ('pre'|'post') so hooks without a direct
 * pre/post analogue (SessionEnd, Stop) still round-trip through this type —
 * collapsing to the DB's column is the sync layer's job, not this type's. */
export type HarnessEventType = 'pre_tool_use' | 'post_tool_use' | 'session_end' | 'stop'

/**
 * The normalized, already-redacted shape every harness capture package
 * (starting with @tages/harness-claude-code) produces from its native hook/
 * event payload before it's appended to the local SQLite log. `project_id`
 * is deliberately absent here — hooks have no concept of a Tages project;
 * it's attached later, at sync time, from the loaded project config.
 */
export interface HarnessEvent {
  source: HarnessSource
  sessionId: string
  eventType: HarnessEventType
  agentName?: string | null
  toolName?: string | null
  /** Exit status when known (e.g. Bash tool_response.exit_code). Absent for
   * tools/events that don't report one — never fabricate a value. */
  exitCode?: number | null
  filePath?: string | null
  /** Derived by pairing PostToolUse with its matching PreToolUse; null when
   * no matching PreToolUse was observed in this process's lifetime. */
  durationMs?: number | null
  /** Tool input/response, secret- and PII-redacted via redactSensitiveData
   * BEFORE this object is constructed. Never raw. */
  argsScrubbed?: Record<string, unknown> | null
  resultSummary?: string | null
  secretsRedactedCount: number
  createdAt: string
}
