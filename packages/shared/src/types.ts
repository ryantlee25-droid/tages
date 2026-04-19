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
  // Structured metadata (optional — enriches recall quality)
  conditions?: string[]
  phases?: string[]
  crossSystemRefs?: string[]
  examples?: MemoryExample[]
  executionFlow?: ExecutionFlow
  verifiedAt?: string
  createdAt: string
  updatedAt: string
  encrypted?: boolean
  createdBy?: string
  updatedBy?: string
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
