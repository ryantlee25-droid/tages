import { randomUUID } from 'crypto'
import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

/**
 * Parses a session summary and auto-extracts memories.
 * Agents call this at the end of a session with a summary of what was built/decided.
 *
 * The summary is parsed for keywords that map to memory types:
 * - "decided" / "chose" / "went with" → decision
 * - "convention" / "pattern" / "always" / "never" → convention
 * - "architecture" / "module" / "structure" → architecture
 * - "learned" / "gotcha" / "watch out" → lesson
 * - "created" / "added" / "new component" → entity
 */
export async function handleSessionEnd(
  args: { summary: string; extractMemories?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const shouldExtract = args.extractMemories !== false
  const extracted: Array<{ key: string; value: string; type: MemoryType }> = []

  if (shouldExtract) {
    // Split summary into sentences/bullet points
    const lines = args.summary
      .split(/[.\n]/)
      .map(l => l.trim())
      .filter(l => l.length > 10)

    for (const line of lines) {
      const lower = line.toLowerCase()
      let type: MemoryType | null = null
      let key = ''

      if (/\b(decided|chose|went with|picked|selected|opted)\b/.test(lower)) {
        type = 'decision'
        key = `decision-${slugify(line.slice(0, 50))}`
      } else if (/\b(convention|pattern|always|never|must|naming|style)\b/.test(lower)) {
        type = 'convention'
        key = `convention-${slugify(line.slice(0, 50))}`
      } else if (/\b(architecture|module|structure|layer|boundary|directory|layout)\b/.test(lower)) {
        type = 'architecture'
        key = `arch-${slugify(line.slice(0, 50))}`
      } else if (/\b(learned|gotcha|watch out|careful|bug|issue|mistake|avoid)\b/.test(lower)) {
        type = 'lesson'
        key = `lesson-${slugify(line.slice(0, 50))}`
      } else if (/\b(created|added|new|built|implemented|introduced)\b/.test(lower)) {
        type = 'entity'
        key = `entity-${slugify(line.slice(0, 50))}`
      }

      if (type && key) {
        extracted.push({ key, value: line, type })
      }
    }

    // Store extracted memories
    const now = new Date().toISOString()
    for (const mem of extracted) {
      const memory: Memory = {
        id: randomUUID(),
        projectId,
        key: mem.key,
        value: mem.value,
        type: mem.type,
        source: 'agent',
        status: 'live' as const,  // 0.8 confidence is above 0.75 gate threshold
        confidence: 0.8,
        filePaths: [],
        tags: ['session-extract'],
        createdAt: now,
        updatedAt: now,
      }

      cache.upsertMemory(memory, true)
      if (sync) {
        await sync.remoteInsert(memory)
      }
    }
  }

  if (extracted.length > 0) {
    const lines = extracted.map(m => `- [${m.type}] ${m.key}: ${m.value}`)
    return {
      content: [{
        type: 'text',
        text: `Session recorded. Extracted ${extracted.length} memories:\n\n${lines.join('\n')}`,
      }],
    }
  }

  return {
    content: [{
      type: 'text',
      text: 'Session summary recorded. No extractable memories found — consider using `remember` for specific decisions or conventions.',
    }],
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
