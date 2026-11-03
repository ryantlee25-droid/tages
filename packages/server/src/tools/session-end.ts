import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { extractMemoriesFromSummary } from './session-extract'
import { embedOnWrite } from './embed-on-write'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Capped await: short-lived servers would otherwise exit before the embedding lands. */
const EMBED_TIMEOUT_MS = 10_000

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
  supabaseClient?: SupabaseClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const shouldExtract = args.extractMemories !== false
  const extracted = shouldExtract ? extractMemoriesFromSummary(args.summary) : []

  if (shouldExtract && extracted.length > 0) {
    const now = new Date().toISOString()
    const embeds: Array<Promise<void>> = []
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
        const ok = await sync.remoteInsert(memory)
        if (ok) cache.markSynced([memory.id])
      }
      // After remoteInsert: remoteUpdateEmbedding needs the remote row to exist.
      // Started per row concurrently, so the total wait is capped at ~10s.
      embeds.push(embedOnWrite(memory, memory.value, cache, sync, supabaseClient, { timeoutMs: EMBED_TIMEOUT_MS }))
    }
    await Promise.all(embeds)
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

