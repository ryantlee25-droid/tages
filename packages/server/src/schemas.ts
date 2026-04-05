import { z } from 'zod'

export const MemoryTypeSchema = z.enum([
  'convention', 'decision', 'architecture',
  'entity', 'lesson', 'preference', 'pattern',
])

export const MemorySourceSchema = z.enum([
  'manual', 'auto_index', 'agent', 'import',
])

export const RememberSchema = z.object({
  key: z.string().min(1).describe('A short, descriptive key for this memory'),
  value: z.string().min(1).describe('The memory content'),
  type: MemoryTypeSchema.describe('The type of memory'),
  filePaths: z.array(z.string()).optional().describe('Related file paths'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
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
