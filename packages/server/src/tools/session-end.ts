import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { extractMemoriesFromSummary } from './session-extract'

/**
 * Parses a session summary and auto-extracts memories.
 * Agents call this at the end of a session with a summary of what was built/decided.
 */
export async function handleSessionEnd(
  args: { summary: string; extractMemories?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const shouldExtract = args.extractMemories !== false
  const extracted = shouldExtract ? extractMemoriesFromSummary(args.summary) : []

  if (shouldExtract && extracted.length > 0) {
    const now = new Date().toISOString()
    for (const mem of extracted) {
      const memory: Memory = {
        id: randomUUID(),
        projectId,
        key: mem.key,
        value: mem.value,
        type: mem.type,
        source: 'agent',
        status: 'live' as const,
        confidence: 0.8,
        filePaths: [],
        tags: ['session-extract'],
        createdAt: now,
        updatedAt: now,
        ...(callerUserId ? { createdBy: callerUserId, updatedBy: callerUserId } : {}),
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

