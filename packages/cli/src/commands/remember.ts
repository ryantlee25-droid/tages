import chalk from 'chalk'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { randomUUID } from 'crypto'
import { openCliSync, type FlushResult } from '../sync/cli-sync.js'
import { extractDatesFromMemory } from '../lib/date-extraction.js'
import { generateEmbedding, generateChunkEmbeddings } from '../lib/embedding.js'

interface RememberOptions {
  type: string
  project?: string
  filePaths?: string[]
  tags?: string[]
}

export async function rememberCommand(key: string, value: string, options: RememberOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const now = new Date().toISOString()

  // Temporal anchoring (Task C / migration 0060): extract absolute/relative
  // dates referenced in the memory text, resolved against the write time.
  // Runs inline — regex-based extraction is local/cheap with no network
  // call, so it must be set before the memory is constructed/upserted.
  const extractedDates = extractDatesFromMemory(key, value, new Date(now))

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
    referencedDate: extractedDates.referencedDate,
    relativeDate: extractedDates.relativeDate,
    createdAt: now,
    updatedAt: now,
  }

  const { cache, flush, flushWithResult, close } = await openCliSync(config)
  let syncResult: FlushResult | undefined
  try {
    // Generate a DURABLE embedding synchronously (await) before this one-shot
    // process exits. The long-lived MCP server can fire-and-forget embedding
    // generation (scheduleEmbeddingSync in packages/server/src/tools/remember.ts),
    // but the CLI process would exit before any deferred embedding resolved —
    // leaving embedding=null and the memory invisible to semantic recall.
    // Same opt-in gate as CLI recall (recall.ts:79): generateEmbedding returns
    // null when neither Ollama nor the opt-in OpenAI path (TAGES_OPENAI_EMBED)
    // is available, so this adds no latency/cost when embeddings are disabled.
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
    // embedding pass via generateEmbedding. Post-Fix-A generateChunkEmbeddings
    // shares generateEmbedding's Ollama-first/OpenAI-opt-in selection (embedOne),
    // so the pooled vector lands in the SAME space as the recall-time query in
    // every provider config; the pooled vector is chunk-mean-pooled in all
    // configs now (not a whole-text embed). generateEmbedding stays as the
    // fallback for when no chunk provider is available (returns null).
    let embedding: number[] | null = null
    let chunks: Array<{ text: string; embedding: number[] }> | null = null
    try {
      const chunkResult = await generateChunkEmbeddings(value)
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

