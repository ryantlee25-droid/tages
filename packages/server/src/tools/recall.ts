import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { generateEmbedding } from '../embeddings'
import { rankResults, asTextResults, reorderByTemporalProximity } from '../search/ranker'
import type { ScoredMemory } from '../search/ranker'
import { computeDecayScore, shouldArchive } from '../decay/scoring'
import { getEncryptionKey, decryptValue } from '../crypto/encryption'
import { budgetedResults } from '../search/token-budget'
import { rerankMemories } from '../search/reranker'
import { fetchTemporalCandidates, fuseMemoryLists } from '../search/temporal-channel'

// PLAN.md Task 6: candidate pool widened before rerank/fusion narrow it back
// down to args.limit. Overridable for tuning/testing, mirroring the CLI's
// TAGES_RECALL_CANDIDATE_POOL pattern (packages/cli/src/commands/recall.ts).
const RECALL_CANDIDATE_POOL = Number(process.env.TAGES_RECALL_CANDIDATE_POOL) || 50

// PLAN.md Task 2/6: only the top-N candidates are sent through the
// cross-encoder/judge rerank pass — matches the CLI's Task 2 window.
const RERANK_TOP_K = 20

function decryptMemories(memories: Memory[]): Memory[] {
  const encKey = getEncryptionKey()
  return memories.map((m) => {
    if (m.encrypted) {
      if (!encKey) {
        // Memory is marked as encrypted but no key is available — fail loudly
        return { ...m, value: '[ERROR: memory is encrypted but TAGES_ENCRYPTION_KEY is not set]' }
      }
      // Per-row failure isolation: decryptValue throws (decipher.final(), see
      // crypto/encryption.ts) whenever this key cannot open THIS row's
      // ciphertext — the routine case once two developers share a project with
      // different TAGES_ENCRYPTION_KEY values, since there is no key
      // distribution mechanism. Without this catch, one undecryptable row
      // threw away the ENTIRE recall response, including every row that
      // decrypted fine. Substitute a per-row placeholder in the same style as
      // the no-key-set branch above and let the other rows through, so the
      // response still carries the same number of rows.
      try {
        return { ...m, value: decryptValue(m.value, encKey) }
      } catch {
        return { ...m, value: '[ERROR: memory could not be decrypted with the configured TAGES_ENCRYPTION_KEY]' }
      }
    }
    // Not encrypted — return as-is regardless of whether a key is configured
    return m
  })
}

export async function handleRecall(
  args: { query: string; type?: string; limit?: number; maxTokens?: number; assembledContext?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  // PLAN.md Task 7: optional raw Supabase client for the temporal date-range
  // channel. `SupabaseSync` (the only Supabase handle previously threaded
  // through this function) keeps its client private and is out of this
  // task's file ownership, so the temporal channel is wired as a trailing
  // optional argument instead. The current `index.ts` call site doesn't pass
  // one yet, so the channel contributes zero candidates (fetchTemporalCandidates
  // is skipped entirely) until that follow-up wiring lands — see
  // search/temporal-channel.ts's module doc for the full rationale.
  supabaseClient?: SupabaseClient,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit || 5

  // Generate embedding for semantic search (works locally via Ollama)
  const embedding = await generateEmbedding(args.query)

  // Try local unified scoring first (sub-10ms, no network)
  const scoredResults = cache.scoredQuery(
    projectId,
    args.query,
    embedding || null,
    args.type as MemoryType | undefined,
    limit * 3, // over-fetch for ranking
  )

  if (scoredResults.length > 0) {
    // Update access times for all recalled memories (T6)
    for (const { memory } of scoredResults) {
      cache.updateAccessTime(memory.id)
    }

    // Apply decay scoring to demote stale results (T6)
    const decayAdjusted: ScoredMemory[] = scoredResults.map(r => {
      const accessInfo = cache.getAccessInfo(r.memory.id)
      const decayScore = computeDecayScore(r.memory, {
        lastAccessedAt: accessInfo?.lastAccessedAt,
        accessCount: accessInfo?.accessCount ?? 0,
      })
      // Demote stale memories: multiply text/semantic scores by (1 - decay * 0.5)
      const decayPenalty = 1 - decayScore * 0.5
      return {
        memory: r.memory,
        semanticScore: r.semanticScore * decayPenalty,
        textScore: r.textScore * decayPenalty,
      }
    })

    const ranked = rankResults(decayAdjusted, {}, args.query)
    let sliced = decryptMemories(ranked.slice(0, limit))
    if (args.maxTokens !== undefined) {
      sliced = budgetedResults(sliced, args.maxTokens, formatMemory)
    }
    return args.assembledContext
      ? formatAssembledContext(sliced, args.query)
      : formatResults(sliced, args.query, 'local (ranked)')
  }

  // If local cache is empty, try remote
  if (sync) {
    if (embedding) {
      // PLAN.md Task 6: widen the candidate pool passed to remoteHybridRecall
      // so rerank has more than `limit` rows to work with; narrowed back down
      // to `limit` only after rerank + temporal reordering below.
      const poolLimit = Math.max(limit, RECALL_CANDIDATE_POOL)
      // PLAN.md Task 11: the chunk channel runs alongside remoteHybridRecall,
      // not gated on it — a long memory whose pooled vector misses the
      // threshold entirely (the mean-pool-dilution zero-hit case Phase 2
      // exists to fix) is findable ONLY via chunk_semantic_recall, so an
      // empty hybrid list must not short-circuit the chunk results.
      const [hybridResults, chunkResults] = await Promise.all([
        sync.remoteHybridRecall(args.query, embedding, args.type, poolLimit),
        sync.remoteChunkSemanticRecall(embedding, args.type, poolLimit),
      ])
      if ((hybridResults && hybridResults.length > 0) || (chunkResults && chunkResults.length > 0)) {
        // PLAN.md Task 7: temporal date-range channel — a further candidate
        // source. No-op (empty array, zero queries) for non-temporal queries
        // or when no supabaseClient was threaded through — see this
        // function's supabaseClient param doc and search/temporal-channel.ts.
        const temporalCandidates = supabaseClient
          ? await fetchTemporalCandidates(supabaseClient, projectId, args.query, poolLimit)
          : []
        const fused = fuseMemoryLists([hybridResults ?? [], chunkResults ?? [], temporalCandidates])

        // PLAN.md Task 6: cross-encoder rerank pass, inserted BEFORE
        // reorderByTemporalProximity so temporal anchoring stays the final
        // ordering authority (Tier-1 design intent: rerank informs
        // relevance, temporal proximity has final say over order).
        //
        // PRE-EXISTING LIMITATION (not introduced by this task, flagged per
        // PLAN.md Task 6's own pre-mortem): this whole remote-hybrid branch
        // only runs when handleRecall's warm-local-SQLite branch above
        // (`scoredResults.length > 0`) does NOT return early. Most real
        // MCP-tool calls against a populated local cache never reach this
        // rerank at all — only users hitting the remote-hybrid fallback path
        // see Task 6/7's effect. This is a known, documented scope boundary,
        // not a bug to fix here.
        // Fix 4 (finding 4): decrypt the candidate memories BEFORE rerank so the
        // cross-encoder scores PLAINTEXT values, not ciphertext. Previously
        // decryptMemories ran only after rerank + reorder, so on an
        // encrypted-at-rest project the reranker judged opaque `enc:v1:...`
        // blobs and produced meaningless relevance scores.
        const decrypted = decryptMemories(fused)
        const reranked = await rerankMemories(decrypted, args.query, RERANK_TOP_K)
        const reordered = reorderByTemporalProximity(reranked, args.query)
        const limited = reordered.slice(0, limit)

        let trimmed = limited
        if (args.maxTokens !== undefined) {
          trimmed = budgetedResults(trimmed, args.maxTokens, formatMemory)
        }
        return args.assembledContext
          ? formatAssembledContext(trimmed, args.query)
          : formatResults(trimmed, args.query, 'remote (hybrid)')
      }
    }

    const results = await sync.remoteRecall(args.query, args.type, limit)
    if (results && results.length > 0) {
      let trimmed = decryptMemories(results)
      if (args.maxTokens !== undefined) {
        trimmed = budgetedResults(trimmed, args.maxTokens, formatMemory)
      }
      return args.assembledContext
        ? formatAssembledContext(trimmed, args.query)
        : formatResults(trimmed, args.query, 'remote (trigram)')
    }
  }

  // Last fallback: SQLite LIKE search without embeddings
  const fallback = cache.queryMemories(
    projectId, args.query, args.type as MemoryType | undefined, limit,
  )
  const ranked = rankResults(asTextResults(fallback), {}, args.query)
  let sliced = decryptMemories(ranked.slice(0, limit))
  if (args.maxTokens !== undefined) {
    sliced = budgetedResults(sliced, args.maxTokens, formatMemory)
  }
  return args.assembledContext
    ? formatAssembledContext(sliced, args.query)
    : formatResults(sliced, args.query, 'local (text match)')
}

// Format the calling agent's citation date from a memory's ISO timestamp.
// Guards against a legacy/backfilled row whose updatedAt is missing or empty:
// calling .slice on undefined would throw and crash the entire recall tool for
// a single bad row, so fall back to a safe placeholder instead.
function formatCiteDate(iso: string | undefined | null): string {
  if (!iso) return 'unknown'
  return iso.slice(0, 10) // YYYY-MM-DD
}

// Body lines shared between the per-passage formatter (formatResults) and the
// token-estimation formatter (formatMemory) below — kept as one function so
// the two never drift apart.
function formatMemoryBody(m: Memory): string[] {
  const parts: string[] = [`   ${m.value}`]
  // Temporal anchoring (migration 0060): surface the two extracted dates
  // alongside the header's `updated:` date so the answering model actually
  // sees them, not just the fact that they're stored.
  if (m.referencedDate || m.relativeDate) {
    const dateBits: string[] = []
    if (m.referencedDate) dateBits.push(`referenced ${formatCiteDate(m.referencedDate)}`)
    if (m.relativeDate) dateBits.push(`relative ${formatCiteDate(m.relativeDate)}`)
    parts.push(`   Dates: ${dateBits.join(', ')}`)
  }
  if (m.filePaths?.length) parts.push(`   Files: ${m.filePaths.join(', ')}`)
  if (m.conditions?.length) parts.push(`   When: ${m.conditions.join('; ')}`)
  if (m.crossSystemRefs?.length) parts.push(`   Related: ${m.crossSystemRefs.join(', ')}`)
  if (m.executionFlow) {
    parts.push(`   Flow: ${m.executionFlow.trigger} → ${m.executionFlow.steps.join(' → ')}`)
  }
  if (m.examples?.length) {
    for (const ex of m.examples.slice(0, 2)) {
      parts.push(`   Example: ${ex.input} → ${ex.output}${ex.note ? ` (${ex.note})` : ''}`)
    }
  }
  if (m.tags?.length) parts.push(`   Tags: ${m.tags.join(', ')}`)
  return parts
}

// Format one passage with a stable, citable [n] id plus explicit
// source/date provenance (Task 13). `index` is the passage's 1-based
// position in this response — the client agent can cite it directly,
// e.g. "per [2], ...".
function formatPassage(m: Memory, index: number): string {
  const source = m.source || 'unknown'
  const header = `[${index}] [${m.type}] ${m.key}  (source: ${source}, updated: ${formatCiteDate(m.updatedAt)})`
  return [header, ...formatMemoryBody(m)].join('\n')
}

// Format a single memory to a string — used only for token-budget estimation
// (packages/server/src/search/token-budget.ts), which needs a per-memory
// length estimate before the final passage index is known. Passage index 1
// is used as a stand-in; the length difference vs. the real index is at
// most a couple of characters and does not materially affect budgeting.
function formatMemory(m: Memory): string {
  return formatPassage(m, 1)
}

// PLAN.md Task 4 (server half): opt-in "assembled context" output — one
// deduped, chronologically-ordered block instead of numbered passages.
// Mirrors the CLI's `--assembled-context` flag
// (packages/cli/src/commands/recall.ts) at a formatting level only; the two
// are independently wired per SPLIT.md's file-ownership split and share no
// code (per-package duplication convention). Reuses formatMemoryBody
// (already shared with formatPassage) and formatCiteDate — no new
// token-budget helper needed here since every call site already runs its
// memories through budgetedResults (search/token-budget.ts) before invoking
// either this function or formatResults.
//
// Grouping: two tiers only ("top-tier fused/reranked" vs. "fallback that
// survived the candidate pool but got cut") per Task 4's own pre-mortem
// mitigation — this collapses to a single tier in practice, since by the
// time this function is called every call site has already sliced down to
// its final selected set (args.limit or a maxTokens budget); there is no
// separate "cut" set still in scope to form a second tier. Documented
// simplest-shippable default, not an oversight.
function formatAssembledContext(
  memories: Memory[],
  query: string,
): { content: Array<{ type: 'text'; text: string }> } {
  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: `No memories found matching "${query}".` }],
    }
  }

  const resolveDate = (m: Memory): string | undefined => m.referencedDate ?? m.relativeDate ?? m.createdAt

  const sorted = [...memories].sort((a, b) => {
    const ta = new Date(resolveDate(a) ?? '').getTime()
    const tb = new Date(resolveDate(b) ?? '').getTime()
    const va = Number.isNaN(ta) ? Infinity : ta
    const vb = Number.isNaN(tb) ? Infinity : tb
    return va - vb // chronological, oldest first
  })

  const entries = sorted.map((m) => {
    const header = `[${formatCiteDate(resolveDate(m))}] [${m.type}] ${m.key}`
    return [header, ...formatMemoryBody(m)].join('\n')
  })

  const preamble = `Assembled context for "${query}" — ${memories.length} memories, chronologically ordered.`

  return {
    content: [{
      type: 'text',
      text: `${preamble}\n\n${entries.join('\n\n')}`,
    }],
  }
}

function formatResults(
  memories: Memory[],
  query: string,
  method: string,
): { content: Array<{ type: 'text'; text: string }> } {
  if (memories.length === 0) {
    return {
      content: [{ type: 'text', text: `No memories found matching "${query}".` }],
    }
  }

  const passages = memories.map((m, i) => formatPassage(m, i + 1))
  const preamble = `Found ${memories.length} memories for "${query}" (${method}). Passages are numbered [1]-[${memories.length}] — cite the passage number(s) that support your answer.`

  return {
    content: [{
      type: 'text',
      text: `${preamble}\n\n${passages.join('\n\n')}`,
    }],
  }
}
