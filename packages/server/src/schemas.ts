import { z } from 'zod'

export const MemoryTypeSchema = z.enum([
  'convention', 'decision', 'architecture',
  'entity', 'lesson', 'preference', 'pattern', 'execution',
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
  }).optional().describe('Execution context to filter results'),
  limit: z.number().int().min(1).max(50).default(5).describe('Max results'),
})

export const ResolveConflictSchema = z.object({
  conflictId: z.string().min(1).describe('ID of the conflict to resolve'),
  strategy: z.enum(['keep_newer', 'keep_older', 'merge']).describe('Resolution strategy'),
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
