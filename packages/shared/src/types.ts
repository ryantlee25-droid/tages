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

export type MemorySource =
  | 'manual'
  | 'auto_index'
  | 'agent'
  | 'import'

export interface Memory {
  id: string
  projectId: string
  key: string
  value: string
  type: MemoryType
  source: MemorySource
  agentName?: string
  filePaths?: string[]
  tags?: string[]
  confidence: number
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
  userId: string
  role: 'owner' | 'admin' | 'member'
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
