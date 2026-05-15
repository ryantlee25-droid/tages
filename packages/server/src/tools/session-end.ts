import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { extractMemoriesFromSummary } from './session-extract'

/**
 * Parses a session summary and auto-extracts memories.
 * Agents call this at the end of a session with a summary of what was built/decided.
 *
 * If autoSaveThreshold is provided (non-null), a promotion sweep runs after extraction:
 * any pending memory for the project with confidence >= threshold is promoted to live.
 * Session-extracted memories are written at confidence=0.8 and will be swept if the
 * threshold is <= 0.8.  Pass null (or omit) to skip the sweep entirely (default).
 */
export async function handleSessionEnd(
  args: { summary: string; extractMemories?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
  autoSaveThreshold: number | null = null,
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
        status: 'pending' as const,
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

  // Run the auto-promotion sweep over all pending memories for this project
  // (including pre-existing ones from observe calls, and just-written session extracts).
  // Guard: only runs when the caller supplies a non-null threshold — opt-in per the spec.
  if (autoSaveThreshold != null) {
    cache.promoteMemories(projectId, autoSaveThreshold)
  }

  if (extracted.length > 0) {
    const lines = extracted.map(m => `- [${m.type}] ${m.key}: ${m.value}`)
    return {
      content: [{
        type: 'text',
        text: `Session recorded. Staged ${extracted.length} pending memories for review:\n\n${lines.join('\n')}\n\nRun \`tages pending\` to review or visit your project's /pending page in the dashboard.`,
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

