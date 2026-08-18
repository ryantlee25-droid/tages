import chalk from 'chalk'
import {
  isEvidenceLevel,
  EVIDENCE_LEVELS,
  scanForSensitiveData,
  hasHighSeverity,
  formatSafetyWarnings,
  type Memory,
  type MemoryType,
  type EvidenceLevel,
} from '@tages/shared'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { randomUUID } from 'crypto'
import { openCliSync, type FlushResult } from '../sync/cli-sync.js'
import { readAuthFile } from '../auth/store.js'
import { extractDatesFromMemory } from '../lib/date-extraction.js'
import { generateEmbedding, generateChunkEmbeddings } from '../lib/embedding.js'

interface RememberOptions {
  type: string
  project?: string
  filePaths?: string[]
  tags?: string[]
  evidence?: string
  force?: boolean
}

/**
 * The signed-in user's JWT for the hosted embedding endpoint
 * (PLAN-HOSTED-EMBEDDING.md Task 3).
 *
 * remember.ts needs its OWN Supabase client for this: the one it already uses
 * is private inside openCliSync's cli-sync internals and is not reachable from
 * here. recall.ts already builds its own client the same way, so this follows
 * an existing pattern rather than inventing one.
 *
 * Fills the same precedence slot as the server copy's
 * `opts.supabaseClient.auth.getSession()` lookup — ahead of the
 * TAGES_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY chain that
 * lib/embedding.ts applies when this returns undefined. When TAGES_SERVICE_KEY
 * is set we skip building a client at all: createAuthenticatedClient would
 * build a service-role client that has no session anyway, and lib/embedding.ts
 * picks the key up from env one step later.
 *
 * Everything here is best-effort. A token we cannot resolve degrades the
 * memory to trigram-only; it must never cost us the write, so no failure in
 * this function is allowed to escape.
 *
 * Duplicated (small, deliberate) from commands/recall.ts rather than shared
 * from lib/embedding.ts: this module's unit tests mock '../lib/embedding.js'
 * with an explicit two-function factory, so a new import from that module
 * would resolve to undefined at runtime under test.
 */
async function resolveHostedEmbedToken(
  supabaseUrl?: string,
  supabaseAnonKey?: string,
): Promise<string | undefined> {
  if (process.env.TAGES_SERVICE_KEY) return undefined
  if (!supabaseUrl || !supabaseAnonKey) return undefined
  try {
    const supabase = await createAuthenticatedClient(supabaseUrl, supabaseAnonKey)
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? undefined
  } catch {
    return undefined
  }
}

export async function rememberCommand(key: string, value: string, options: RememberOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  // Reject an unrecognised level before anything is written. A free-text
  // evidence value is worse than none: the field's only purpose is to be
  // interpretable by a reader deciding whether to act or check, and it stops
  // being that the moment arbitrary strings can land in it. Fails closed —
  // nothing is stored locally or remotely.
  if (options.evidence !== undefined && !isEvidenceLevel(options.evidence)) {
    console.error(chalk.red(`Unknown --evidence level: "${options.evidence}"`))
    console.error(chalk.dim(`Expected one of: ${EVIDENCE_LEVELS.join(', ')}`))
    console.error(
      chalk.dim(
        'verified = checked against something executable · declared = asserted as policy · ' +
          'observed = seen once · inferred = reasoned, not checked · disputed = contradicted',
      ),
    )
    process.exit(1)
  }

  // Secret/PII scan, mirroring the MCP server's remember tool
  // (packages/server/src/tools/remember.ts). The CLI previously did not scan at
  // ALL — the end-to-end suite caught `tages remember` happily persisting an
  // AWS key that the agent path blocks. That asymmetry is the worst way round:
  // the human-typed path is the one where a pasted config snippet arrives, and
  // a stored secret is then readable by every project member and pulled into
  // every agent's context by recall.
  //
  // Fails closed and BEFORE any write, local or remote. `--force` is the same
  // deliberate override the MCP tool exposes.
  const warnings = scanForSensitiveData(`${key} ${value}`)
  if (hasHighSeverity(warnings) && !options.force) {
    console.error(chalk.red(`Blocked: "${key}" contains detected secrets.`))
    console.error(formatSafetyWarnings(warnings))
    console.error(chalk.dim('Nothing was stored. Remove the secret, or pass --force if this is a false positive.'))
    process.exit(1)
  }

  const now = new Date().toISOString()

  // Temporal anchoring (Task C / migration 0060): extract absolute/relative
  // dates referenced in the memory text, resolved against the write time.
  // Runs inline — regex-based extraction is local/cheap with no network
  // call, so it must be set before the memory is constructed/upserted.
  const extractedDates = extractDatesFromMemory(key, value, new Date(now))

  const authorId = readAuthFile()?.userId

  const memory: Memory = {
    id: randomUUID(),
    projectId: config.projectId,
    key,
    value,
    type: options.type as MemoryType,
    source: 'manual',
    filePaths: options.filePaths || [],
    tags: options.tags || [],
    status: 'live',
    confidence: 1.0,
    // A deliberate human `remember` is a declaration: true because someone
    // decided it, not because anything checked it. Defaulting to `verified`
    // would manufacture confidence nobody established, which is the failure
    // this field exists to prevent (migration 0070).
    evidence: (options.evidence as EvidenceLevel | undefined) ?? 'declared',
    referencedDate: extractedDates.referencedDate,
    relativeDate: extractedDates.relativeDate,
    createdAt: now,
    updatedAt: now,
    // Authorship (migration 0048). The columns have existed since 0048 and the
    // sync mapper has always carried them, but no CLI write ever populated
    // them — so `get_memory_authors` returned "Unknown" for everything and a
    // shared memory could not be attributed to whoever wrote or last edited it.
    // The server sets these from its callerUserId; the CLI's equivalent is the
    // signed-in identity in auth.json. `createdBy` is filled in below, only for
    // rows that do not already exist.
    ...(authorId ? { updatedBy: authorId } : {}),
  }

  const { cache, flush, flushWithResult, close } = await openCliSync(config)

  // createdBy ONLY for a genuinely new key. remoteInsert upserts with
  // `onConflict: 'project_id,key'`, and a Supabase upsert overwrites every
  // column it is given — so stamping createdBy on an edit would quietly
  // reassign authorship of somebody else's memory to whoever last touched it.
  // updatedBy above is exactly the field that is supposed to move.
  // createdBy is deliberately NOT set here. Migration 0074 pins it in the
  // database: filled from auth.uid() on insert, and held to its existing value
  // on update. The client cannot make this call correctly — deciding whether to
  // send an id or leave it alone requires knowing whether the row exists
  // REMOTELY, and the CLI's pull is rate-limited, so a teammate's row may
  // legitimately be absent from the local cache. Guessing from local state
  // rewrote a teammate's authorship to the editor.
  // No local lookup: the database owns created_by outright now, so reading it
  // back here would be redundant work AND would call getByKey on a path where
  // it is otherwise only used to resolve a chunk parent id.

  let syncResult: FlushResult | undefined
  try {
    // Generate a DURABLE embedding synchronously (await) before this one-shot
    // process exits. The long-lived MCP server can fire-and-forget embedding
    // generation (scheduleEmbeddingSync in packages/server/src/tools/remember.ts),
    // but the CLI process would exit before any deferred embedding resolved —
    // leaving embedding=null and the memory invisible to semantic recall.
    // Same provider selection as CLI recall: the process's one resolved
    // TAGES_EMBED_PROVIDER (hosted by default). generateEmbedding returns null
    // whenever that provider is unavailable, so this adds no cost and loses no
    // memory when embeddings can't be produced.
    // Embed the value only, mirroring the server's plaintextForIndex
    // (packages/server/src/tools/remember.ts:113 — the key is used for the token
    // index, not the embedding), so CLI- and server-written vectors share a space.
    // Guard the embedding call: generateEmbedding may throw (network error,
    // Ollama down mid-request, provider 5xx). A throw here must NEVER lose the
    // memory — fall back to the plain upsert path so the fact is still stored
    // (trigram-recallable now, embedding backfilled later out-of-band).
    // Single-pass embedding (Task 11 integration): generateChunkEmbeddings
    // returns BOTH the per-chunk vectors and their mean-pool in one pass, so
    // we take the pooled vector from it instead of paying a second, redundant
    // embedding pass via generateEmbedding. It shares generateEmbedding's
    // provider switch (embedOne), so the pooled vector lands in the SAME space
    // as the recall-time query in every provider config. generateEmbedding
    // stays as the fallback for when the chunk pass yields nothing.
    //
    // The hosted context is threaded to generateChunkEmbeddings only, not to
    // the generateEmbedding fallback below. That is not an oversight: under
    // hosted, a null from generateChunkEmbeddings means the endpoint already
    // failed, so a second hosted call would fail identically — and the
    // fallback's call signature is pinned by an existing single-argument
    // assertion in a test file this task does not own. Under ollama/openai the
    // hosted context is ignored entirely, so nothing is lost either way.
    let embedding: number[] | null = null
    let chunks: Array<{ text: string; embedding: number[] }> | null = null
    try {
      const chunkResult = await generateChunkEmbeddings(value, {
        supabaseUrl: config.supabaseUrl,
        accessToken: await resolveHostedEmbedToken(config.supabaseUrl, config.supabaseAnonKey),
        projectId: config.projectId,
      })
      if (chunkResult) {
        embedding = chunkResult.pooled
        chunks = chunkResult.chunks
      }
    } catch (err) {
      console.error(
        chalk.yellow('Chunk embedding generation failed; falling back to pooled-only.'),
        err instanceof Error ? err.message : String(err),
      )
    }
    if (!embedding) {
      try {
        embedding = await generateEmbedding(value)
      } catch (err) {
        console.error(
          chalk.yellow('Embedding generation failed; storing without embedding.'),
          err instanceof Error ? err.message : String(err),
        )
        embedding = null
      }
    }

    // Primary write: SQLite first (dirty=1 marks it for sync).
    if (embedding) {
      // Store embedding alongside the row and mark it dirty so flush() carries
      // it to Supabase: getDirty()/rowToMemory reconstructs memory.embedding
      // from the SQLite TEXT column, and memoryToDbRow serializes it to pgvector.
      cache.upsertMemoryWithEmbedding(memory, embedding, true)
    } else {
      // Embeddings disabled/unavailable — trigram-only fallback, no regression.
      cache.upsertMemory(memory, true)
    }

    // Task 9 (Phase 2): per-chunk embeddings for chunk-aware recall, same
    // synchronous/awaited durable-write design as the pooled embedding above
    // (see this function's header comment) — the CLI process exits right
    // after this returns, so there is no fire-and-forget background path
    // like the MCP server's scheduleEmbeddingSync to fall back on.
    //
    // Resolve the actual persisted row id via getByKey rather than trusting
    // the local `memory` variable's id: upsertMemory's ON CONFLICT(project_id,
    // key) DO UPDATE keeps the EXISTING row's id on a re-remember of an
    // existing key, but `memory.id` above is always a freshly generated
    // randomUUID() (see upsertMemoryWithEmbedding's own comment on this exact
    // mismatch). Chunk rows carry a memory_id reference, so they must be
    // associated with the row's real id, not a possibly-stale local one.
    if (chunks) {
      const persisted = cache.getByKey(config.projectId, key)
      cache.upsertChunks(persisted?.id ?? memory.id, config.projectId, chunks)
    }

    // Cloud sync — never fatal, but never silent either. Also carries any
    // dirty chunk rows written above (SupabaseSync._flush pushes dirty chunks
    // alongside dirty memories — see supabase-sync.ts's _flushDirtyChunks).
    //
    // The outcome decides which line we print below. Reporting a green
    // "Stored:" on a failed cloud write is how a memory ends up living only in
    // this developer's local SQLite (dirty=1), invisible to every teammate,
    // with nobody aware it never left the machine.
    //
    // flushWithResult is probed rather than called blind: a caller (unit tests
    // mocking openCliSync) may supply a context that only has the older
    // void-returning flush(). Absent outcome information is treated as success
    // — the pre-existing behaviour — never as a spurious failure.
    if (typeof flushWithResult === 'function') {
      syncResult = await flushWithResult()
    } else {
      await flush()
    }
  } finally {
    close()
  }

  if (syncResult && !syncResult.ok) {
    // Deliberately NOT the green "Stored:" form, and deliberately not a
    // non-zero exit: the memory IS durably written locally and a later sync
    // (or `tages status`) can still push it, so failing the process would
    // break agent hooks and scripts over a recoverable condition.
    console.error(chalk.yellow('Stored locally only:'), `"${key}" (${options.type})`)
    console.error(
      chalk.yellow('  Cloud sync failed:'),
      syncResult.error || 'unknown error',
    )
    console.error(
      chalk.dim("  Teammates will not see this memory. Run 'tages status' to check sync state."),
    )
    return
  }

  console.log(chalk.green('Stored:'), `"${key}" (${options.type})`)
}

