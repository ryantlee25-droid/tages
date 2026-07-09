import { randomUUID } from 'crypto'
import type { Memory, MemoryExample, ExecutionFlow } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData, formatSafetyWarnings, hasHighSeverity } from './safety'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import { computeFieldDiff } from '../diff/field-diff'
import { tokenize } from '../search/tokenizer'
import { generateEmbedding } from '../embeddings'
import { extractDates } from '../temporal/date-extraction'

export async function handleRemember(
  args: {
    key: string
    value: string
    type: string
    filePaths?: string[]
    tags?: string[]
    conditions?: string[]
    phases?: string[]
    crossSystemRefs?: string[]
    examples?: MemoryExample[]
    executionFlow?: ExecutionFlow
    force?: boolean
  },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  plan?: string,
  callerUserId?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Check memory limit for free tier
  // Fast-path: check local SQLite count first (avoids network round-trip when clearly under limit)
  if ((!plan || plan === 'free') && cache.countMemories(projectId) >= 10000) {
    return {
      content: [{
        type: 'text',
        text: 'Memory limit reached (10,000 on free tier). Upgrade to Pro for 50,000 memories: https://app.tages.ai/upgrade',
      }],
    }
  }
  // Authoritative enforcement: check Supabase count to prevent bypass via local cache mismatch
  if ((!plan || plan === 'free') && sync) {
    const remoteCount = await sync.remoteCountMemories()
    if (remoteCount !== null && remoteCount >= 10000) {
      return {
        content: [{
          type: 'text',
          text: 'Memory limit reached (10,000 on free tier). Upgrade to Pro for 50,000 memories: https://app.tages.ai/upgrade',
        }],
      }
    }
  }

  // Scan for secrets/PII — block high-severity unless force override
  const warnings = scanForSensitiveData(`${args.key} ${args.value}`)
  if (hasHighSeverity(warnings) && !args.force) {
    return {
      content: [{
        type: 'text',
        text: `Blocked: memory "${args.key}" contains detected secrets.${formatSafetyWarnings(warnings)}`,
      }],
    }
  }

  const now = new Date().toISOString()
  const existing = cache.getByKey(projectId, args.key)

  const memory: Memory = {
    id: existing?.id || randomUUID(),
    projectId,
    key: args.key,
    value: args.value,
    type: args.type as Memory['type'],
    source: 'agent',
    status: 'live',
    filePaths: args.filePaths || [],
    tags: args.tags || [],
    confidence: 1.0,
    conditions: args.conditions,
    phases: args.phases,
    crossSystemRefs: args.crossSystemRefs,
    examples: args.examples,
    executionFlow: args.executionFlow,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(callerUserId && !existing ? { createdBy: callerUserId } : {}),
    ...(callerUserId ? { updatedBy: callerUserId } : {}),
  }

  // T5: Compute and store field-level diff before upsert
  if (existing) {
    const fieldChanges = computeFieldDiff(existing, memory)
    if (fieldChanges.length > 0) {
      // Get the latest version id (or use memory id as fallback)
      const versions = cache.getVersions(projectId, args.key)
      const versionId = versions.length > 0 ? `${memory.id}-v${versions[0].version + 1}` : `${memory.id}-v1`
      for (const change of fieldChanges) {
        cache.addFieldChange(
          versionId,
          memory.id,
          projectId,
          change.field,
          change.oldValue,
          change.newValue,
          change.changeType as 'added' | 'removed' | 'modified',
        )
      }
    }
  }

  // Capture plaintext for indexing before potential encryption
  const plaintextForIndex = memory.value

  // Temporal anchoring (Task C / migration 0060): extract absolute/relative
  // dates referenced in the memory text, resolved against the write time.
  // Runs inline (NOT fire-and-forget like embedding generation below) —
  // regex-based extraction is local/cheap with no network call, so there's
  // no latency reason to defer it, and it must be set before the upsert.
  const extractedDates = extractDates(`${memory.key} ${plaintextForIndex}`, new Date(now))
  memory.referencedDate = extractedDates.referencedDate
  memory.relativeDate = extractedDates.relativeDate

  // Encrypt value at rest if encryption key is configured
  const encKey = getEncryptionKey()
  if (encKey) {
    memory.value = encryptValue(memory.value, encKey)
    memory.encrypted = true
  }

  cache.upsertMemory(memory, true)

  // T8: Tokenize and index for full-text search (use plaintext, not ciphertext)
  const tokens = tokenize(`${memory.key} ${plaintextForIndex}`)
  if (tokens.length > 0) {
    cache.indexMemoryTokens(memory.id, projectId, tokens)
  }

  // Try remote write immediately; cache is dirty if this fails
  if (sync) {
    const ok = await sync.remoteInsert(memory)
    if (ok) cache.markSynced([memory.id])
  }

  // T8 (Task 8): generate + store + sync the document embedding for semantic
  // search. Fire-and-forget — never block the tool response on this network
  // call. Generated from plaintextForIndex (pre-encryption plaintext), never
  // from ciphertext, so encrypted-at-rest memories still get correct vectors.
  scheduleEmbeddingSync(memory, plaintextForIndex, cache, sync)

  const action = existing ? 'Updated' : 'Stored'
  const extras: string[] = []
  if (args.conditions?.length) extras.push(`${args.conditions.length} conditions`)
  if (args.examples?.length) extras.push(`${args.examples.length} examples`)
  if (args.executionFlow) extras.push('execution flow')
  if (args.crossSystemRefs?.length) extras.push(`${args.crossSystemRefs.length} cross-refs`)
  const extraNote = extras.length ? ` [${extras.join(', ')}]` : ''
  const safetyNote = formatSafetyWarnings(warnings)

  return {
    content: [{
      type: 'text',
      text: `${action} memory: "${args.key}" (${args.type})${extraNote}${safetyNote}`,
    }],
  }
}

/**
 * Generate a semantic-search embedding for a memory and sync it to the local
 * cache and Supabase, without blocking the caller.
 *
 * Deliberately not awaited by handleRemember — embedding generation is a
 * network call (Ollama or OpenAI) that can take seconds, and the MCP tool
 * response must return immediately. Any failure here (no provider available,
 * network error) is logged and swallowed; the memory itself is already safely
 * stored by the time this runs.
 *
 * Race-safety — this path resolves SECONDS after the original write, so by the
 * time it runs the row it captured may have been overwritten (a concurrent
 * remember(key, V2)) or deleted (a concurrent forget). Therefore it must NOT
 * re-write the full captured row. It performs a NARROW, embedding-only,
 * (project_id, key)-keyed update in both places:
 *
 *   - Locally via cache.setEmbedding: touches only the `embedding` column,
 *     never value/tags/dirty. No-op if the row was deleted. This avoids
 *     reverting V2 back to the stale captured V1 (data loss) and avoids
 *     clearing a dirty flag that a newer update set (stranded flush).
 *   - Remotely via sync.remoteUpdateEmbedding: an `.update()` (not upsert)
 *     serialized on the same queue as remoteDelete, so it cannot resurrect a
 *     row deleted by a concurrent forget, and cannot clobber a newer value.
 *
 * We deliberately do NOT markSynced here: the whole-row dirty state belongs to
 * the write path, not the embedding path.
 */
function scheduleEmbeddingSync(
  memory: Memory,
  plaintext: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): void {
  const { projectId, key } = memory
  void generateEmbedding(plaintext)
    .then(async (embedding) => {
      if (!embedding) return
      // Local: embedding-only column update, keyed by (projectId, key).
      cache.setEmbedding(projectId, key, embedding)
      if (sync) {
        // Remote: serialized, embedding-only update; no-op if row was deleted.
        await sync.remoteUpdateEmbedding(projectId, key, embedding)
      }
    })
    .catch((err) => {
      console.error('[tages] Embedding generation/sync failed:', (err as Error).message)
    })
}
