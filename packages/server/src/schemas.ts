import { z } from 'zod'

export const MemoryTypeSchema = z.enum([
  'convention', 'decision', 'architecture',
  'entity', 'lesson', 'preference', 'pattern', 'execution',
  'operational', 'environment',
])

export const MemorySourceSchema = z.enum([
  'manual', 'auto_index', 'agent', 'import',
])

export const MemoryExampleSchema = z.object({
  input: z.string().describe('Example input or trigger'),
  output: z.string().describe('Expected output or result'),
  note: z.string().optional().describe('Additional context'),
})

export const ExecutionFlowSchema = z.object({
  trigger: z.string().describe('What initiates this flow'),
  steps: z.array(z.string()).describe('Ordered execution steps'),
  phases: z.array(z.string()).optional().describe('Named phases within the flow'),
  hooks: z.array(z.string()).optional().describe('Event hooks or injection points'),
})

export const RememberSchema = z.object({
  key: z.string().min(1).describe('A short, descriptive key for this memory'),
  value: z.string().min(1).describe('The memory content'),
  type: MemoryTypeSchema.describe('The type of memory'),
  filePaths: z.array(z.string()).optional().describe('Related file paths'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  conditions: z.array(z.string()).optional().describe('When this applies — conditions or prerequisites'),
  phases: z.array(z.string()).optional().describe('Phases or stages this memory relates to'),
  crossSystemRefs: z.array(z.string()).optional().describe('Keys of related memories in other systems'),
  examples: z.array(MemoryExampleSchema).optional().describe('Concrete input/output examples'),
  executionFlow: ExecutionFlowSchema.optional().describe('Step-by-step execution pipeline (for execution type)'),
  force: z.boolean().optional().default(false).describe('Override secret detection blocking'),
})

export const RecallSchema = z.object({
  query: z.string().min(1).describe('Search query for fuzzy matching'),
  type: MemoryTypeSchema.optional().describe('Filter by memory type'),
  limit: z.number().int().min(1).max(50).default(5).describe('Max results'),
})

export const ForgetSchema = z.object({
  key: z.string().min(1).describe('The key of the memory to delete'),
})

export const ConventionsSchema = z.object({})

export const ArchitectureSchema = z.object({})

export const DecisionsSchema = z.object({})

export const ContextSchema = z.object({
  filePath: z.string().min(1).describe('File path to get context for'),
})

export const SessionEndSchema = z.object({
  summary: z.string().min(1).describe('Summary of what happened in this session'),
  extractMemories: z.boolean().optional().describe('Auto-extract memories from the summary (default: true)'),
})

export const VerifyMemorySchema = z.object({
  key: z.string().min(1).describe('Key of the pending memory to verify'),
})

export const StatsDetailSchema = z.object({})

export const MemoryHistorySchema = z.object({
  key: z.string().min(1).describe('Key of the memory to get history for'),
  revertToVersion: z.number().int().min(1).optional().describe('Version number to revert to'),
})

export const ContextualRecallSchema = z.object({
  query: z.string().describe('Search query (can be empty to list all contextual matches)'),
  context: z.object({
    currentFiles: z.array(z.string()).optional().describe('Currently open or relevant file paths'),
    agentName: z.string().optional().describe('Name of the requesting agent'),
    phase: z.string().optional().describe('Current phase (e.g., planning, implementation, review)'),
    depth: z.number().int().min(0).max(2).default(0).optional().describe('Multi-hop graph traversal depth via crossSystemRefs (0=direct only, 1=one hop, 2=two hops)'),
  }).optional().describe('Execution context to filter results'),
  limit: z.number().int().min(1).max(50).default(5).describe('Max results'),
})

export const ResolveConflictSchema = z.object({
  conflictId: z.string().min(1).describe('ID of the conflict to resolve'),
  strategy: z.enum(['keep_newer', 'keep_older', 'merge', 'auto_merge']).describe('Resolution strategy (auto_merge uses 3-way LCS merge)'),
  mergedValue: z.string().optional().describe('Merged content (required when strategy is "merge")'),
  resolvedBy: z.string().optional().describe('Agent or user resolving the conflict'),
})

export const SuggestionsSchema = z.object({})

export const ImportSchema = z.object({
  content: z.string().min(1).max(512_000).describe('JSON array or markdown content to import (max 500KB)'),
  format: z.enum(['json', 'markdown', 'auto']).optional().default('auto').describe('Input format'),
  strategy: z.enum(['skip', 'overwrite', 'merge']).optional().default('skip').describe('Duplicate handling strategy'),
})

export const MemoryGraphSchema = z.object({})

// XL1 — Deduplication
export const DedupSchema = z.object({
  threshold: z.number().min(0.1).max(1.0).optional().describe('Jaccard similarity threshold (default 0.7)'),
})

export const ConsolidateSchema = z.object({
  survivorKey: z.string().min(1).describe('Key of the memory to keep'),
  victimKey: z.string().min(1).describe('Key of the memory to delete and merge into survivor'),
  mergedValue: z.string().optional().describe('Custom merged value (optional, defaults to more detailed version)'),
})

// XL2 — Impact analysis
export const ImpactAnalysisSchema = z.object({
  key: z.string().min(1).describe('Memory key to analyze impact for'),
})

export const RiskReportSchema = z.object({})
export const GraphAnalysisSchema = z.object({})

// XL3 — Convention enforcement
export const CheckConventionSchema = z.object({
  key: z.string().min(1).describe('Memory key to check against all conventions'),
  agentName: z.string().optional().describe('Agent name for violation tracking'),
})

export const EnforcementReportSchema = z.object({})

// XL4 — Quality scoring
export const MemoryQualitySchema = z.object({
  key: z.string().min(1).describe('Memory key to score'),
})

export const ProjectHealthSchema = z.object({})

// XL5 — Templates
export const ListTemplatesSchema = z.object({})

export const MatchTemplatesSchema = z.object({
  filePaths: z.array(z.string()).describe('File paths to match against templates'),
})

export const ApplyTemplateSchema = z.object({
  templateId: z.string().min(1).describe('Template ID to apply'),
  fields: z.record(z.string()).describe('Field values for the template'),
  filePaths: z.array(z.string()).optional().describe('Related file paths'),
})

// XL6 — Archive
export const ArchiveSchema = z.object({
  key: z.string().min(1).describe('Memory key to archive'),
  reason: z.string().optional().describe('Reason for archiving'),
})

export const RestoreSchema = z.object({
  key: z.string().min(1).describe('Memory key to restore from archive'),
})

export const ListArchivedSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().describe('Max archived memories to list'),
})

export const ArchiveStatsSchema = z.object({})
export const AutoArchiveSchema = z.object({
  qualityThreshold: z.number().min(0).max(100).optional().describe('Archive memories below this quality score (default 20)'),
  stalenessDays: z.number().min(1).optional().describe('Archive memories not accessed in this many days (default 60)'),
})

// XL7 — Federation
export const PromoteSchema = z.object({
  key: z.string().min(1).describe('Memory key to promote to federated library'),
  scope: z.enum(['org', 'team', 'public']).optional().describe('Federation scope (default: org)'),
  promotedBy: z.string().optional().describe('Agent/user promoting this memory'),
})

export const ImportFederatedSchema = z.object({
  key: z.string().min(1).describe('Federated memory key to import into this project'),
})

export const ListFederatedSchema = z.object({
  scope: z.enum(['org', 'team', 'public']).optional().describe('Filter by scope'),
})

export const ResolveOverridesSchema = z.object({})

// XL8 — Analytics
export const SessionReplaySchema = z.object({
  sessionId: z.string().min(1).describe('Session ID to replay'),
})

export const AgentMetricsSchema = z.object({
  agentName: z.string().optional().describe('Filter by agent name'),
})

export const TrendsSchema = z.object({
  agentName: z.string().optional().describe('Filter by agent name'),
})
