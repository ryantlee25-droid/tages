import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory, MemoryExample, ExecutionFlow } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData, formatSafetyWarnings, hasHighSeverity } from './safety'
import { getEncryptionKey, encryptValue } from '../crypto/encryption'
import { computeFieldDiff } from '../diff/field-diff'
import { tokenize } from '../search/tokenizer'
import { embedOnWrite } from './embed-on-write'
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
    evidence?: Memory['evidence']
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
    // An agent writing about a codebase it just read has, by default,
    // *concluded* something rather than checked it. `inferred` is the honest
    // floor: a model that omits the field gets the cautious label, and must
    // claim `verified` explicitly to get credit for having actually checked.
    // Defaulting the other way would let every unexamined guess arrive dressed
    // as a fact, which is the failure this field exists to prevent (0070).
    evidence: args.evidence ?? 'inferred',
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
  // Shared helper (tools/embed-on-write.ts), same path observe/session_end/
  // verify_memory/import_claude_md use.
  void embedOnWrite(memory, plaintextForIndex, cache, sync, supabaseClient)

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
