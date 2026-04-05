import { randomUUID } from 'crypto'
import type { Memory, MemoryType, MemorySource } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

type DuplicateStrategy = 'skip' | 'overwrite' | 'merge'

interface ImportResult {
  imported: number
  skipped: number
  merged: number
  errors: string[]
}

interface PartialMemory {
  key: string
  value: string
  type?: string
  tags?: string[]
  filePaths?: string[]
  conditions?: string[]
  confidence?: number
}

function parseJsonMemories(input: string): PartialMemory[] {
  const parsed = JSON.parse(input)
  if (!Array.isArray(parsed)) {
    throw new Error('JSON input must be an array of memory objects')
  }
  return parsed as PartialMemory[]
}

function parseMarkdownMemories(input: string): PartialMemory[] {
  const memories: PartialMemory[] = []
  // Parse markdown format: ## key\nvalue\n[optional metadata]
  const sections = input.split(/^## /m).filter(Boolean)

  for (const section of sections) {
    const lines = section.trim().split('\n')
    const key = lines[0].trim()
    if (!key) continue

    const valueLines: string[] = []
    let currentType = 'convention'
    const tags: string[] = []
    const filePaths: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('**type:**')) {
        currentType = line.replace('**type:**', '').trim()
      } else if (line.startsWith('**tags:**')) {
        const tagStr = line.replace('**tags:**', '').trim()
        tags.push(...tagStr.split(',').map((t) => t.trim()).filter(Boolean))
      } else if (line.startsWith('**files:**')) {
        const fileStr = line.replace('**files:**', '').trim()
        filePaths.push(...fileStr.split(',').map((f) => f.trim()).filter(Boolean))
      } else if (line && !line.startsWith('**')) {
        valueLines.push(line)
      }
    }

    const value = valueLines.join('\n').trim()
    if (key && value) {
      memories.push({
        key,
        value,
        type: currentType,
        tags: tags.length > 0 ? tags : undefined,
        filePaths: filePaths.length > 0 ? filePaths : undefined,
      })
    }
  }

  return memories
}

function detectFormat(input: string): 'json' | 'markdown' {
  const trimmed = input.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
  return 'markdown'
}

export async function handleImport(
  args: {
    content: string
    format?: 'json' | 'markdown' | 'auto'
    strategy?: DuplicateStrategy
    projectId: string
  },
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }>; result: ImportResult }> {
  const strategy = args.strategy || 'skip'
  const format = args.format === 'auto' || !args.format
    ? detectFormat(args.content)
    : args.format

  let partials: PartialMemory[]
  try {
    if (format === 'json') {
      partials = parseJsonMemories(args.content)
    } else {
      partials = parseMarkdownMemories(args.content)
    }
  } catch (err) {
    return {
      result: { imported: 0, skipped: 0, merged: 0, errors: [(err as Error).message] },
      content: [{ type: 'text', text: `Import failed: ${(err as Error).message}` }],
    }
  }

  if (partials.length === 0) {
    return {
      result: { imported: 0, skipped: 0, merged: 0, errors: [] },
      content: [{ type: 'text', text: 'No memories found in input.' }],
    }
  }

  const result: ImportResult = { imported: 0, skipped: 0, merged: 0, errors: [] }
  const now = new Date().toISOString()

  for (const partial of partials) {
    if (!partial.key || !partial.value) {
      result.errors.push(`Skipping entry without key or value`)
      continue
    }

    const existing = cache.getByKey(args.projectId, partial.key)

    if (existing) {
      if (strategy === 'skip') {
        result.skipped++
        continue
      } else if (strategy === 'overwrite') {
        cache.upsertMemory({
          ...existing,
          value: partial.value,
          type: (partial.type || existing.type) as MemoryType,
          tags: partial.tags || existing.tags,
          filePaths: partial.filePaths || existing.filePaths,
          conditions: partial.conditions || existing.conditions,
          confidence: partial.confidence ?? existing.confidence,
          updatedAt: now,
          source: 'import' as MemorySource,
        })
        result.imported++
      } else {
        // merge: combine values
        const mergedValue = existing.value === partial.value
          ? existing.value
          : `${existing.value}\n\n${partial.value}`
        cache.upsertMemory({
          ...existing,
          value: mergedValue,
          tags: [...new Set([...(existing.tags || []), ...(partial.tags || [])])],
          filePaths: [...new Set([...(existing.filePaths || []), ...(partial.filePaths || [])])],
          updatedAt: now,
          source: 'import' as MemorySource,
        })
        result.merged++
      }
    } else {
      const memory: Memory = {
        id: randomUUID(),
        projectId: args.projectId,
        key: partial.key,
        value: partial.value,
        type: (partial.type || 'convention') as MemoryType,
        source: 'import' as MemorySource,
        status: 'live',
        tags: partial.tags || [],
        filePaths: partial.filePaths || [],
        conditions: partial.conditions,
        confidence: partial.confidence ?? 1.0,
        createdAt: now,
        updatedAt: now,
      }
      cache.upsertMemory(memory)
      result.imported++
    }
  }

  const summaryParts = [`Imported: ${result.imported}`, `Skipped: ${result.skipped}`, `Merged: ${result.merged}`]
  if (result.errors.length > 0) summaryParts.push(`Errors: ${result.errors.length}`)

  return {
    result,
    content: [{
      type: 'text',
      text: `## Import Complete\n${summaryParts.join(' | ')}\n\nTotal processed: ${partials.length}`,
    }],
  }
}
