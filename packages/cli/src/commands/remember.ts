import chalk from 'chalk'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { randomUUID } from 'crypto'
import { openCliSync } from '../sync/cli-sync.js'
import { extractDatesFromMemory } from '../lib/date-extraction.js'
import { generateEmbedding } from '../lib/embedding.js'

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

  const { cache, flush, close } = await openCliSync(config)
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
    const embedding = await generateEmbedding(value)

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

    // Best-effort cloud sync — never fatal
    await flush()
  } finally {
    close()
  }

  console.log(chalk.green('Stored:'), `"${key}" (${options.type})`)
}

