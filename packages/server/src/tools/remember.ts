import { randomUUID } from 'crypto'
import type { Memory, MemoryExample, ExecutionFlow } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData, formatSafetyWarnings, hasHighSeverity } from './safety'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import { computeFieldDiff } from '../diff/field-diff'
import { tokenize } from '../search/tokenizer'
import { generateEmbedding } from '../embeddings'

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
 * Race-safety: this pushes the embedding directly via `sync.remoteInsert`
 * once computed, rather than waiting on the periodic dirty-flag flush cycle.
 * `memoryToDbRow` (supabase-sync.ts) omits the `embedding` column entirely
 * when a Memory has no embedding set, instead of writing null, so the
 * earlier synchronous remoteInsert() call in handleRemember (which runs
 * before this embedding is ready) cannot clobber an existing embedding —
 * it simply leaves the column untouched until this fires.
 */
function scheduleEmbeddingSync(
  memory: Memory,
  plaintext: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): void {
  void generateEmbedding(plaintext)
    .then(async (embedding) => {
      if (!embedding) return
      const embeddedMemory: Memory = { ...memory, embedding }
      cache.upsertMemoryWithEmbedding(embeddedMemory, embedding, true)
      if (sync) {
        const ok = await sync.remoteInsert(embeddedMemory)
        if (ok) cache.markSynced([memory.id])
      }
    })
    .catch((err) => {
      console.error('[tages] Embedding generation/sync failed:', (err as Error).message)
    })
}
