import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { extractMemoriesFromSummary } from './session-extract'
import { embedOnWrite } from './embed-on-write'
import { scanForSensitiveData, hasHighSeverity, formatSafetyWarnings, type SafetyWarning } from './safety'
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

  // Same secret gate as `remember` (no --force here): an extracted memory
  // with a high-severity secret is never stored, synced or sent to the
  // embedding provider. Medium (PII) warnings are stored and surfaced.
  const accepted: typeof extracted = []
  const blockedNames = new Set<string>()
  let blocked = 0
  const piiWarnings: SafetyWarning[] = []
  for (const mem of extracted) {
    const warnings = scanForSensitiveData(`${mem.key} ${mem.value}`)
    if (hasHighSeverity(warnings)) {
      blocked++
      for (const w of warnings) if (w.severity === 'high') blockedNames.add(w.name)
      continue
    }
    for (const w of warnings) {
      if (!piiWarnings.some(p => p.name === w.name)) piiWarnings.push(w)
    }
    accepted.push(mem)
  }

  if (shouldExtract && accepted.length > 0) {
    const now = new Date().toISOString()
    const written: Array<{ memory: Memory; plaintext: string }> = []
    for (const mem of accepted) {
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
      // Stored readable on purpose (as before 0.5.7): no read path for these rows
      // decrypts (conventions, project_brief, resources, the review queue, the
      // dashboard), so ciphertext here would make imported rules and pending
      // memories unreadable to agents and reviewers. Known gap; see CHANGELOG.

      cache.upsertMemory(memory, true)
      if (sync) {
        const ok = await sync.remoteInsert(memory)
        if (ok) cache.markSynced([memory.id])
      }
      written.push({ memory, plaintext: mem.value })
    }

    // After the inserts: remoteUpdateEmbedding needs the remote row to exist.
    // One row at a time under one shared 10s deadline (a burst of concurrent
    // hosted calls trips 546/429 and yields nulls). Rows not started by the
    // deadline are NOT fanned out: they keep a null embedding, which
    // verify_memory fills on approval and the boot backfill
    // (runEmbeddingBackfill) fills for any live row still missing one.
    const deadline = Date.now() + EMBED_TIMEOUT_MS
    let deferred = 0
    for (const { memory, plaintext } of written) {
      const left = deadline - Date.now()
      if (left <= 0) {
        deferred++
        continue
      }
      await embedOnWrite(memory, plaintext, cache, sync, supabaseClient, { timeoutMs: left })
    }
    if (deferred > 0) {
      console.error(
        `[tages] session_end: embedding deadline reached; ${deferred} of ${written.length} memories left ` +
          'without an embedding for the boot backfill to pick up',
      )
    }
  }

  const blockedNote = blocked > 0
    ? `\n\nBlocked ${blocked} extracted ${blocked === 1 ? 'memory' : 'memories'} containing detected secrets ` +
      `(${[...blockedNames].join(', ')}); ${blocked === 1 ? 'it was' : 'they were'} not stored. ` +
      'Remove the secret from the summary before recording it.'
    : ''

  if (accepted.length > 0) {
    const lines = accepted.map(m => `- [${m.type}] ${m.key}: ${m.value}`)
    return {
      content: [{
        type: 'text',
        text: `Session recorded. Staged ${accepted.length} pending memories for review:\n\n${lines.join('\n')}\n\nRun \`tages pending\` to review or visit your project's /pending page in the dashboard.${blockedNote}${formatSafetyWarnings(piiWarnings)}`,
      }],
    }
  }

  if (blocked > 0) {
    return {
      content: [{ type: 'text', text: `Session summary recorded. No memories were staged.${blockedNote}` }],
    }
  }

  return {
    content: [{
      type: 'text',
      text: 'Session summary recorded. No extractable memories found — consider using `remember` for specific decisions or conventions.',
    }],
  }
}

