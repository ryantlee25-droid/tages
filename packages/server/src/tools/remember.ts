import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory, MemoryExample, ExecutionFlow } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData, formatSafetyWarnings, hasHighSeverity } from './safety'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import { computeFieldDiff } from '../diff/field-diff'
import { tokenize } from '../search/tokenizer'
import { generateEmbedding, generateChunkEmbeddings } from '../embeddings'
import { extractDatesFromMemory } from '../temporal/date-extraction'

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
  // Hosted embedding (PLAN-HOSTED-EMBEDDING.md Task 2): the hosted provider
  // needs a Supabase URL + a bearer token to reach
  // `${supabaseUrl}/functions/v1/embed`, and `SupabaseSync` keeps its client
  // private. Threaded as a TRAILING OPTIONAL param — mirroring the identical
  // pattern handleRecall already uses for its temporal channel (recall.ts:64,
  // wired at index.ts:285) — so every existing caller and test keeps compiling
  // unchanged. When omitted, the hosted path falls back to env config and, if
  // that is absent too, simply yields no embedding (never throws).
  supabaseClient?: SupabaseClient,
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
  const extractedDates = extractDatesFromMemory(memory.key, plaintextForIndex, new Date(now))
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

  // Try remote write immediately; cache is dirty if this fails.
  //
  // Durability detection (see remoteFailureReason usage below): SupabaseSync
  // .remoteInsert already reports failure as a `false` RETURN VALUE — on a
  // Supabase error it logs and `return false`, and its own catch also returns
  // false (packages/server/src/sync/supabase-sync.ts). It is therefore NOT
  // like SupabaseSync.flush(), which returns void and leaves the caller with
  // no signal at all. So the boolean is the authoritative durability signal
  // here and a try/catch alone would catch nothing.
  //
  // The try/catch below is still required for one narrow case: remoteInsert
  // calls `memoryToDbRow(memory)` + `wal.logPending(...)` OUTSIDE its own try
  // block, so a WAL/serialisation failure escapes as a real throw. That throw
  // also means the row never reached Supabase, so it is folded into the same
  // local-only outcome rather than being allowed to fail the whole tool call.
  let remoteDurable = false
  let remoteFailureReason: string | null = null
  if (sync) {
    const captured = beginRemoteErrorCapture()
    try {
      remoteDurable = await sync.remoteInsert(memory)
    } catch (err) {
      remoteDurable = false
      remoteFailureReason = (err as Error).message
    } finally {
      endRemoteErrorCapture(captured)
    }

    if (remoteDurable) {
      cache.markSynced([memory.id])
    } else {
      remoteFailureReason =
        remoteFailureReason ||
        captured[0] ||
        'the cloud write was rejected or the database was unreachable'
    }
  }

  // T8 (Task 8): generate + store + sync the document embedding for semantic
  // search. Fire-and-forget — never block the tool response on this network
  // call. Generated from plaintextForIndex (pre-encryption plaintext), never
  // from ciphertext, so encrypted-at-rest memories still get correct vectors.
  scheduleEmbeddingSync(memory, plaintextForIndex, cache, sync, supabaseClient)

  const action = existing ? 'Updated' : 'Stored'
  const extras: string[] = []
  if (args.conditions?.length) extras.push(`${args.conditions.length} conditions`)
  if (args.examples?.length) extras.push(`${args.examples.length} examples`)
  if (args.executionFlow) extras.push('execution flow')
  if (args.crossSystemRefs?.length) extras.push(`${args.crossSystemRefs.length} cross-refs`)
  const extraNote = extras.length ? ` [${extras.join(', ')}]` : ''
  const safetyNote = formatSafetyWarnings(warnings)

  const label = `"${args.key}" (${args.type})${extraNote}`

  // Fully durable: local cache AND the shared cloud database both confirmed.
  // Unchanged wording — this is the only path that may read as plain success.
  if (remoteDurable) {
    return {
      content: [{
        type: 'text',
        text: `${action} memory: ${label}${safetyNote}`,
      }],
    }
  }

  // Local only. Deliberately NOT a thrown error: the memory IS durably saved
  // in local SQLite and still marked dirty, so the 60s background flush (or
  // the next CLI sync) can push it later. But this text is read by an LLM
  // that will otherwise tell the developer their memory was saved for the
  // team, so it states the limitation in plain language rather than a status
  // code, and never in the plain `${action} memory: ...` success form.
  const localOnly =
    sync === null
      ? `${action} memory in the local cache only: ${label}. Cloud sync is not configured for this project, ` +
        `so this memory was never sent to a shared database and teammates will NOT see it. ` +
        `It is durably saved on this machine only.`
      : `${action} memory in the local cache only: ${label}. The write to the shared cloud database FAILED ` +
        `(${remoteFailureReason}), so teammates will NOT see this memory. It is durably saved on this machine ` +
        `and is still marked unsynced, so the background sync will retry it automatically — do not re-send it. ` +
        `Tell the user this memory is local-only until that sync succeeds.`

  return {
    content: [{
      type: 'text',
      text: `${localOnly}${safetyNote}`,
    }],
  }
}

/**
 * Recover the reason `SupabaseSync.remoteInsert` swallowed.
 *
 * remoteInsert reports failure as `false` but discards WHY: it logs
 * `[tages] Remote insert failed: <message>` and returns. We cannot change
 * supabase-sync.ts, so console.error is TEED (never replaced) to keep a copy
 * of that line for the tool response.
 *
 * Unlike the CLI's one-shot equivalent (packages/cli/src/sync/cli-sync.ts),
 * this runs inside a long-lived MCP server that can be handling overlapping
 * remember calls. A save-then-restore of console.error would race there: two
 * interleaved calls can restore each other's shim and strand one permanently.
 * So the tee is installed at most once, is never uninstalled, and simply fans
 * out to a set of per-call collectors that register/deregister around their
 * own await. Every message is still forwarded to the real console.error
 * untouched. Remove this shim once remoteInsert reports a reason of its own.
 */
const remoteErrorCollectors = new Set<string[]>()
let remoteErrorTeeInstalled = false

function beginRemoteErrorCapture(): string[] {
  if (!remoteErrorTeeInstalled) {
    const realConsoleError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      realConsoleError(...args)
      if (remoteErrorCollectors.size === 0) return
      const line = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
      if (!line.includes('Remote insert failed')) return
      const reason = line
        .replace(/^\[tages\]\s*/, '')
        .replace(/^Remote insert failed:\s*/, '')
        .trim()
      if (reason) for (const collector of remoteErrorCollectors) collector.push(reason)
    }
    remoteErrorTeeInstalled = true
  }
  const collector: string[] = []
  remoteErrorCollectors.add(collector)
  return collector
}

function endRemoteErrorCapture(collector: string[]): void {
  remoteErrorCollectors.delete(collector)
}

/**
 * Generate a semantic-search embedding for a memory and sync it to the local
 * cache and Supabase, without blocking the caller.
 *
 * Deliberately not awaited by handleRemember — embedding generation is a
 * network call (hosted edge function, Ollama, or OpenAI) that can take
 * seconds, and the MCP tool
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
  supabaseClient?: SupabaseClient,
): void {
  const { projectId, key } = memory
  // Both fire-and-forget chains get the SAME options object, so the pooled
  // vector and the per-chunk vectors are produced by one provider against one
  // project — they are compared to each other at recall time.
  const embedOpts = { supabaseClient, projectId }
  void generateEmbedding(plaintext, embedOpts)
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

  // Task 9 (Phase 2): additionally persist per-chunk embeddings for
  // chunk-aware recall. Deliberately a SEPARATE fire-and-forget chain from
  // the pooled embedding above, not chained after it — a chunk-generation or
  // chunk-persistence failure must never affect the pooled embedding write
  // (fail-open for the write path as a whole; chunk generation itself is
  // fail-closed internally, see generateChunkEmbeddings). Keyed by
  // memory.id, not (projectId, key): memory_chunks rows carry a memory_id FK,
  // not a (project_id, key) unique constraint, and handleRemember already
  // guarantees memory.id is the existing row's id on an update (line 70:
  // `existing?.id || randomUUID()`), so this is safe the same way the pooled
  // path's (projectId, key) keying is safe for the memories table.
  // Wrapped in Promise.resolve().then(...) rather than calling
  // generateChunkEmbeddings(plaintext) directly: this guarantees even a
  // SYNCHRONOUS throw from the call itself (not just an async rejection)
  // lands in the .catch() below instead of escaping scheduleEmbeddingSync
  // and crashing handleRemember's caller — consistent with this being a
  // fully fail-open path.
  void Promise.resolve()
    .then(() => generateChunkEmbeddings(plaintext, embedOpts))
    .then(async (result) => {
      if (!result) return
      // Fix B (finding 3): encrypt chunk_text at rest with the SAME field
      // encryption as memories.value when a key is configured — otherwise the
      // chunk mirror leaks the memory's plaintext even though memories.value is
      // encrypted. The per-chunk embedding was computed from PLAINTEXT
      // (result.chunks[].embedding) before this map, exactly as
      // memories.embedding is computed from plaintextForIndex, so semantic
      // search is unaffected while nothing plaintext is persisted at rest.
      const encKey = getEncryptionKey()
      const chunksAtRest = encKey
        ? result.chunks.map((c) => ({ text: encryptValue(c.text, encKey), embedding: c.embedding }))
        : result.chunks
      // Fix C: markChunksSynced clears dirty only for the exact rows upsertChunks
      // just inserted, so a concurrent v2 chunk write during the remote await
      // (below) is not clobbered — see supabase-sync.ts _flushDirtyChunks.
      const rowIds = cache.upsertChunks(memory.id, projectId, chunksAtRest)
      if (sync) {
        const ok = await sync.remoteUpsertChunks(projectId, memory.key, chunksAtRest)
        if (ok) cache.markChunksSynced(rowIds)
      }
    })
    .catch((err) => {
      console.error('[tages] Chunk embedding generation/sync failed:', (err as Error).message)
    })
}
