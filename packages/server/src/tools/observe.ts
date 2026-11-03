import { randomUUID } from 'crypto'
import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData, formatSafetyWarnings } from './safety'
import { tokenize } from '../search/tokenizer'
import { embedOnWrite } from './embed-on-write'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Capped await: phase tests spawn a short-lived server per call, so fire-and-forget would be cut off. */
const EMBED_TIMEOUT_MS = 10_000

/**
 * Passive observation tool. Agents call this during work to report
 * what they're doing. Tages silently extracts memories from the report.
 *
 * Unlike `remember` (explicit, user-driven), `observe` is agent-driven
 * and automatic. Memories extracted have lower confidence (0.7) and
 * source: 'agent'.
 *
 * Usage: Agent calls observe("I'm using snake_case for all API routes
 * because the existing endpoints follow that pattern") → Tages extracts
 * a convention memory automatically.
 */

const PATTERNS: Array<{
  match: RegExp
  type: MemoryType
  keyPrefix: string
}> = [
  // Decisions
  { match: /\b(decided|chose|went with|picked|selected|opted for|using .+ instead of|switched to|migrated to)\b/i, type: 'decision', keyPrefix: 'decision' },
  // Conventions
  { match: /\b(always|never|must|should|convention|pattern|rule|naming|style|format|we use|the standard is|follow the)\b/i, type: 'convention', keyPrefix: 'convention' },
  // Architecture
  { match: /\b(architecture|module|component|layer|boundary|directory|structure|lives in|defined in|imports from|exports)\b/i, type: 'architecture', keyPrefix: 'arch' },
  // Lessons
  { match: /\b(learned|gotcha|watch out|careful|bug|issue|mistake|avoid|don't|broke|fixed because|the reason is)\b/i, type: 'lesson', keyPrefix: 'lesson' },
  // Entities
  { match: /\b(created|added|new|built|implemented|introduced|this (?:class|function|component|module|service))\b/i, type: 'entity', keyPrefix: 'entity' },
]

export async function handleObserve(
  args: { observation: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
  autoSaveThreshold?: number | null,
  supabaseClient?: SupabaseClient,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const text = args.observation.trim()
  if (text.length < 15) {
    return { content: [{ type: 'text', text: 'Observation noted.' }] }
  }

  // Same secret gate as `remember` (no --force here): a high-severity secret
  // is never stored, synced or sent to the embedding provider.
  const warnings = scanForSensitiveData(text)
  if (warnings.some(w => w.severity === 'high')) {
    return {
      content: [{
        type: 'text',
        text: 'Observation skipped — contains potentially sensitive data (API key, password, or credential detected).',
      }],
    }
  }

  // Try to classify the observation
  let matchedType: MemoryType | null = null
  let keyPrefix = ''

  for (const pattern of PATTERNS) {
    if (pattern.match.test(text)) {
      matchedType = pattern.type
      keyPrefix = pattern.keyPrefix
      break
    }
  }

  if (!matchedType) {
    // Not classifiable — note but don't store
    return { content: [{ type: 'text', text: 'Observation noted.' }] }
  }

  // Generate a key from the first meaningful phrase
  const key = `${keyPrefix}-${slugify(text.slice(0, 60))}-${Date.now().toString(36).slice(-4)}`
  const now = new Date().toISOString()

  const memory: Memory = {
    id: randomUUID(),
    projectId,
    key,
    value: text,
    type: matchedType,
    source: 'agent',
    status: 'pending' as const,
    confidence: 0.7,
    filePaths: [],
    tags: ['auto-observed'],
    createdAt: now,
    updatedAt: now,
    ...(callerUserId ? { createdBy: callerUserId, updatedBy: callerUserId } : {}),
  }

  // Encrypt at rest exactly as `remember` does. The token index and the
  // embedder below get the plaintext `text`, never the ciphertext.
  const encKey = getEncryptionKey()
  if (encKey) {
    memory.value = encryptValue(text, encKey)
    memory.encrypted = true
  }

  cache.upsertMemory(memory, true)

  // T8: Tokenize and index for full-text search
  const tokens = tokenize(`${key} ${text}`)
  if (tokens.length > 0) {
    cache.indexMemoryTokens(memory.id, projectId, tokens)
  }

  let remoteOk = true
  if (sync) {
    remoteOk = await sync.remoteInsert(memory)
    if (remoteOk) cache.markSynced([memory.id])
  }

  // Embed at create time (pending rows too: recall filters status='live', so
  // a later promotion needs no embedding work). Must follow remoteInsert:
  // remoteUpdateEmbedding is an update and needs the remote row to exist.
  await embedOnWrite(memory, text, cache, sync, supabaseClient, { timeoutMs: EMBED_TIMEOUT_MS })

  // Immediate auto-save: if the just-stored memory already meets the threshold,
  // promote it to live without waiting for the next sweep.
  if (autoSaveThreshold != null && memory.confidence >= autoSaveThreshold) {
    const promotedAt = new Date().toISOString()
    // Promote remotely FIRST and only then locally (as verify.ts does), so a
    // refused promotion never leaves a pending row with verified_at set.
    let promotedRemotely = true
    if (sync) {
      // Best-effort remote promotion; sync.flush() will catch any remaining
      // dirty records.
      //
      // Routed through remoteVerifyMemory, which keys the REMOTE update on
      // (project_id, key) — the same conflict target remoteInsert upserts on.
      // This previously reached into sync's private client and filtered by
      // `.eq('id', memory.id)`, which matched zero rows for every memory:
      // remoteInsert strips `id`, so Supabase's uuid never equals the local
      // randomUUID(). The remote row stayed `pending` and no teammate's
      // status='live' recall could ever see it, even though the local cache
      // showed it promoted.
      promotedRemotely = remoteOk && await sync.remoteVerifyMemory(projectId, key, promotedAt)
    }
    if (!promotedRemotely) {
      // The shared store refused (RLS: read-only member) or matched zero rows.
      // The local row was never touched, so it is still pending.
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Staged "${key}" (${matchedType}) but auto-save did NOT apply: the shared store refused the promotion ` +
            '(your role may be read-only on this project) or could not be reached. The memory stays pending; ' +
            'an owner or admin must approve it with `tages pending`.',
        }],
      }
    }
    // Local cache is correctly keyed by the local row id.
    cache.updateMemoryStatus(memory.id, 'live', promotedAt)
    console.error(`[tages] Auto-saved observed memory "${key}" (confidence ${memory.confidence} >= threshold ${autoSaveThreshold})`)
    return {
      content: [{
        type: 'text',
        text: `Staged and auto-saved "${key}" (${matchedType}) — confidence ${Math.round(memory.confidence * 100)}% met auto-save threshold.${formatSafetyWarnings(warnings)}`,
      }],
    }
  }

  const localNote = remoteOk
    ? ''
    : ' Note: the shared store did not accept this write, so it is saved on this machine only for now.'
  return {
    content: [{
      type: 'text',
      text: `Staged memory '${key}' for review. Run \`tages pending\` to verify or approve in bulk.${localNote}${formatSafetyWarnings(warnings)}`,
    }],
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}
