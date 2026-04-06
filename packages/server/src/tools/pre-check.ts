import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const PRE_CHECK_TYPES: MemoryType[] = ['anti_pattern', 'convention', 'lesson']

// Stop words to ignore when tokenizing task descriptions
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either',
  'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your', 'we', 'our',
  'i', 'my', 'me', 'new', 'add', 'use', 'using', 'make', 'write',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
}

function scoreMemory(memory: Memory, queryTokens: string[]): number {
  const memText = `${memory.key} ${memory.value}`.toLowerCase()
  let matches = 0
  for (const token of queryTokens) {
    if (memText.includes(token)) matches++
  }
  return matches
}

export async function handlePreCheck(
  args: { taskDescription: string; filePaths?: string[] },
  projectId: string,
  cache: SqliteCache,
  _sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { taskDescription, filePaths } = args

  // Get all live memories of the relevant types
  const allMemories = cache.getAllForProject(projectId).filter(
    (m) => m.status === 'live' && PRE_CHECK_TYPES.includes(m.type as MemoryType),
  )

  const queryTokens = tokenize(taskDescription)
  const seenIds = new Set<string>()
  const matchesByType = new Map<MemoryType, Memory[]>()

  // Score by task description token overlap
  if (queryTokens.length > 0) {
    const scored = allMemories
      .map((m) => ({ memory: m, score: scoreMemory(m, queryTokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20) // cap at 20 total

    for (const { memory } of scored) {
      seenIds.add(memory.id)
      const type = memory.type as MemoryType
      const existing = matchesByType.get(type) || []
      matchesByType.set(type, [...existing, memory])
    }
  }

  // If filePaths provided, also add memories whose filePaths overlap
  if (filePaths && filePaths.length > 0) {
    for (const memory of allMemories) {
      if (seenIds.has(memory.id)) continue
      if (!memory.filePaths || memory.filePaths.length === 0) continue

      const hasOverlap = memory.filePaths.some((fp) =>
        filePaths.some((given) => given.includes(fp) || fp.includes(given)),
      )

      if (!hasOverlap) continue

      seenIds.add(memory.id)
      const type = memory.type as MemoryType
      const existing = matchesByType.get(type) || []
      matchesByType.set(type, [...existing, memory])
    }
  }

  // Build the response
  const totalCount = Array.from(matchesByType.values()).reduce((sum, arr) => sum + arr.length, 0)

  if (totalCount === 0) {
    return {
      content: [{
        type: 'text',
        text: `No gotchas found for "${taskDescription}". No anti-patterns, conventions, or lessons match this task.`,
      }],
    }
  }

  const sections: string[] = [`Before you start "${taskDescription}", watch out for:\n`]

  const typeLabels: Record<string, string> = {
    anti_pattern: 'Anti-Patterns (do NOT do these)',
    convention: 'Conventions (must follow)',
    lesson: 'Lessons Learned (from past experience)',
  }

  for (const type of PRE_CHECK_TYPES) {
    const memories = matchesByType.get(type)
    if (!memories || memories.length === 0) continue

    sections.push(`## ${typeLabels[type]}`)
    for (const m of memories) {
      const lines = [`- **${m.key}**: ${m.value}`]
      if (m.filePaths?.length) lines.push(`  Files: ${m.filePaths.join(', ')}`)
      if (m.conditions?.length) lines.push(`  When: ${m.conditions.join('; ')}`)
      sections.push(lines.join('\n'))
    }
    sections.push('')
  }

  return {
    content: [{
      type: 'text',
      text: sections.join('\n'),
    }],
  }
}
