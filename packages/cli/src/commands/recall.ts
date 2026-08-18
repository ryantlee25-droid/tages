import * as fs from 'fs'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir } from '../config/paths.js'
import { generateEmbedding } from '../lib/embedding.js'
import { sortByTemporalProximity } from '../lib/temporal-sort.js'
import { evidenceWeight, judgeRelevance, type EvidenceLevel } from '@tages/shared'
import { reciprocalRankFusion } from '../lib/rrf.js'
import { rerankCandidates } from '../lib/reranker.js'
import { fetchTemporalCandidates } from '../lib/temporal-recall.js'

interface RecallOptions {
  type?: string
  limit?: string
  project?: string
  all?: boolean
  assembledContext?: boolean
}

// Candidate-pool widening for RRF fusion (PLAN.md Task 1): the hybrid
// search's underlying RPC calls now request more rows than the user's
// requested --limit, so RRF has a wider pool to fuse over before the final
// slice(0, limit). Tunable without a code change via
// TAGES_RECALL_CANDIDATE_POOL, mirroring the TAGES_RECALL_THRESHOLD override
// pattern above.
function getRecallCandidatePool(): number {
  const raw = process.env.TAGES_RECALL_CANDIDATE_POOL
  if (raw === undefined || raw === '') return 50
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return parsed
}

// Top-N window of the fused/deduped candidate list that gets sent to the
// cross-encoder reranker (PLAN.md Task 2). Rows beyond this window keep
// their RRF order and are appended after the reranked subset.
const RERANK_WINDOW = 20

// Character-per-token heuristic for the assembled-context token budget
// (PLAN.md Task 4), matching the char/4 estimate already established by
// packages/server/src/search/token-budget.ts and the chunking helpers —
// duplicated locally per the CLI/server per-package convention rather than
// imported across packages.
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

function getAssembledContextTokenBudget(): number {
  const raw = process.env.TAGES_ASSEMBLED_CONTEXT_TOKEN_BUDGET
  if (raw === undefined || raw === '') return 4000
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 4000
  return parsed
}

/**
 * The signed-in user's JWT for the hosted embedding endpoint
 * (PLAN-HOSTED-EMBEDDING.md Task 3).
 *
 * This fills the same slot as the server copy's
 * `opts.supabaseClient.auth.getSession()` lookup — first in precedence, ahead
 * of the TAGES_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
 * chain that lib/embedding.ts's resolveHostedConfig applies when this returns
 * undefined. The CLI resolves it here rather than passing a client so
 * lib/embedding.ts keeps no @supabase/supabase-js dependency.
 *
 * Never throws: a token we cannot resolve degrades recall to trigram, which is
 * not a reason to fail the command.
 *
 * Duplicated (small, deliberate) in commands/remember.ts rather than shared
 * from lib/embedding.ts: remember.ts's unit tests mock '../lib/embedding.js'
 * with an explicit two-function factory, so any new import from that module
 * would resolve to undefined at runtime under test.
 */
async function resolveHostedEmbedToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? undefined
  } catch {
    return undefined
  }
}

function resolveRowDate(row: Record<string, unknown>): string | undefined {
  return (
    (row.referenced_date as string | undefined) ??
    (row.relative_date as string | undefined) ??
    (row.created_at as string | undefined)
  )
}

// Budget-fitted, chronologically-ordered assembled-context output (PLAN.md
// Task 4). Groups `rows` into two tiers — the top `topTierCount` (the
// fused/reranked/temporally-sorted results that would normally be printed)
// vs. everything else that survived the wider candidate pool but got cut —
// sorts each tier chronologically, dedupes (a no-op safety net; upstream
// callers already ran dedupeNearDuplicateContent), and trims to a
// character-based token-budget estimate.
function printAssembledContext(rows: Record<string, unknown>[], topTierCount: number): void {
  if (rows.length === 0) {
    console.log(chalk.dim('No memories found.'))
    return
  }

  const deduped = dedupeNearDuplicateContent(rows)
  const topTier = deduped.slice(0, topTierCount)
  const fallbackTier = deduped.slice(topTierCount)

  const sortChronological = (list: Record<string, unknown>[]) =>
    [...list].sort((a, b) => {
      const aDate = resolveRowDate(a)
      const bDate = resolveRowDate(b)
      const aTime = aDate ? new Date(aDate).getTime() : 0
      const bTime = bDate ? new Date(bDate).getTime() : 0
      return aTime - bTime
    })

  const ordered = [...sortChronological(topTier), ...sortChronological(fallbackTier)]

  const budget = getAssembledContextTokenBudget()
  let usedTokens = 0
  const entries: string[] = []
  for (const row of ordered) {
    const dateStr = resolveRowDate(row)
    const datePrefix = dateStr ? `[${dateStr.slice(0, 10)}] ` : ''
    const line = `${datePrefix}${row.key as string}: ${row.value as string}`
    const tokens = estimateTokenCount(line)
    if (usedTokens + tokens > budget && entries.length > 0) break
    entries.push(line)
    usedTokens += tokens
  }

  console.log(chalk.bold('Assembled context:') + '\n')
  console.log(entries.join('\n\n'))
}

// Vector similarity threshold for semantic_recall, tunable without a code
// change via TAGES_RECALL_THRESHOLD (see PLAN.md Task 4). Default stays 0.3
// unless a calibration rerun shows a clear win at a different value.
function getRecallThreshold(): number {
  const raw = process.env.TAGES_RECALL_THRESHOLD
  if (raw === undefined || raw === '') return 0.3
  const parsed = parseFloat(raw)
  if (!Number.isFinite(parsed)) return 0.3
  // Clamp into the valid cosine-distance range. A raw -1 would make the vector
  // filter `(1 - cos) > -1` always true (every embedded memory returned,
  // unranked); a raw 2 would reject everything. Clamp rather than trust the
  // env value verbatim.
  return Math.min(1, Math.max(0, parsed))
}

// Directional near-duplicate check: returns true only when `candidate` adds
// nothing new over `kept` — i.e. the candidate's value is fully contained in
// the already-kept value. Direction matters: a candidate that is a SUPERSET of
// (longer than) a kept row is NOT a duplicate, because it carries extra unique
// content and must be preserved. The >=40-char guard avoids pruning on a
// coincidental short-substring match. Deliberately narrow — it should rarely
// fire at session-level ingestion granularity.
function isContainedInKept(candidate: string, kept: string): boolean {
  const normCand = candidate.trim().toLowerCase().replace(/\s+/g, ' ')
  const normKept = kept.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normCand || !normKept) return false
  if (normCand === normKept) return true
  // Only prune when the candidate is at least 40 chars, so we never drop a
  // short distinct row just because its text happens to appear inside a longer
  // kept row by coincidence.
  if (normCand.length < 40) return false
  return normKept.includes(normCand)
}

// Drops later (lower-ranked) rows whose value adds no new content over an
// earlier (higher-ranked) row — i.e. the later row's value is fully contained
// in a kept row. Expects `rows` to already be sorted by rank/relevance so
// "earlier" means "higher-ranked". Never drops a row that is a superset of a
// kept row (it carries new content); the top-ranked row is always kept.
function dedupeNearDuplicateContent(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const kept: Record<string, unknown>[] = []
  for (const row of rows) {
    const value = row.value
    const isDuplicate =
      typeof value === 'string' &&
      kept.some((k) => typeof k.value === 'string' && isContainedInKept(value, k.value as string))
    if (!isDuplicate) {
      kept.push(row)
    }
  }
  return kept
}

export async function recallCommand(query: string | undefined, options: RecallOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!query && !options.all) {
    console.error(chalk.red('Provide a search query, or use --all to list all memories.'))
    process.exit(1)
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 5
  const listAll = options.all || query === '*'

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

    let data: Record<string, unknown>[] | null = null
    let searchMethod = 'trigram'
    // Wider candidate pool for the --assembled-context output mode (Task 4):
    // the two-tier grouping needs access to rows beyond the final
    // slice(0, limit) that `data` gets trimmed to below. Populated in both
    // branches; falls back to `data` itself if somehow left unset.
    let assembledPool: Record<string, unknown>[] | null = null

    if (listAll) {
      // List all memories — no similarity filtering
      let q = supabase
        .from('memories')
        .select('id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, conditions, phases, cross_system_refs, examples, execution_flow, created_at, updated_at, referenced_date, relative_date, evidence')
        .eq('project_id', config.projectId)
        .eq('status', 'live')
        .order('type')
        .order('key')
        .limit(listAll ? 200 : limit)

      if (options.type) {
        q = q.eq('type', options.type)
      }

      const { data: allData, error } = await q

      if (error) {
        console.error(chalk.red(`Recall failed: ${error.message}`))
        process.exit(1)
      }

      data = allData
      assembledPool = allData
      searchMethod = 'all'
    } else {
      // Hybrid search: run trigram + semantic + temporal-channel candidates in
      // parallel over a widened candidate pool (Task 1), fuse via Reciprocal
      // Rank Fusion, dedupe, rerank the fused pool's top window via a
      // cross-encoder (Task 2), then layer temporal-proximity reordering on
      // top (migration 0060, unchanged).
      const candidatePool = getRecallCandidatePool()

      // Trigram search
      const trigramPromise = supabase.rpc('recall_memories', {
        p_project_id: config.projectId,
        p_query: query,
        p_type: options.type || null,
        p_limit: candidatePool,
      })

      // Semantic search. Uses the hosted embedding endpoint by default (no
      // Ollama, no OpenAI key needed); TAGES_EMBED_PROVIDER selects otherwise.
      // Whatever the provider, generateEmbedding returns null on any failure
      // and we fail fast to trigram rather than erroring out the recall — that
      // null-means-skip contract is unchanged by the hosted rollout.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let semanticPromise: any = Promise.resolve({ data: null, error: null })
      // Chunk-level semantic channel (PLAN.md Task 11): matches per-chunk
      // embeddings (migration 0064) and rolls up to the parent memory with
      // the winning chunk's identity. This is the channel that finds long
      // memories whose mean-pooled vector misses the threshold entirely.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let chunkPromise: any = Promise.resolve({ data: null, error: null })
      const embedding = await generateEmbedding(query!, {
        supabaseUrl: config.supabaseUrl,
        accessToken: await resolveHostedEmbedToken(supabase),
        projectId: config.projectId,
      })
      if (embedding) {
        const embeddingStr = `[${embedding.join(',')}]`

        semanticPromise = supabase.rpc('semantic_recall', {
          p_project_id: config.projectId,
          p_embedding: embeddingStr,
          p_type: options.type || null,
          p_limit: candidatePool,
          p_threshold: getRecallThreshold(),
        })
        chunkPromise = supabase.rpc('chunk_semantic_recall', {
          p_project_id: config.projectId,
          p_embedding: embeddingStr,
          p_type: options.type || null,
          p_limit: candidatePool,
          p_threshold: getRecallThreshold(),
        })
        searchMethod = 'hybrid (trigram + semantic + chunk)'
      }

      // Temporal date-range channel (Task 3): zero-cost (no query issued) for
      // non-temporal queries or queries with no resolvable concrete date.
      const temporalPromise = fetchTemporalCandidates(supabase, config.projectId, query!, candidatePool)

      const [trigramResult, semanticResult, temporalRows, chunkResult] = await Promise.all([
        trigramPromise,
        semanticPromise,
        temporalPromise,
        chunkPromise,
      ])

      if (trigramResult.error) {
        console.error(chalk.red(`Recall failed: ${trigramResult.error.message}`))
        process.exit(1)
      }

      // Reciprocal Rank Fusion across the three candidate lists. Semantic
      // listed first, matching the previous merge's "semantic results first"
      // tie-break for row-data preference when the same id ranks equally.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const semanticRows = (semanticResult.data || []).map((r: any) => ({ ...r, match_type: 'semantic' }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trigramRows = (trigramResult.data || []).map((r: any) => ({ ...r, match_type: 'trigram' }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const temporalTagged = (temporalRows || []).map((r: any) => ({ ...r, match_type: 'temporal' }))
      // Chunk rows carry chunk_index/chunk_text (the winning passage) in
      // addition to the parent memory's columns — preserved through fusion
      // for citation. Same id as the parent memory, so RRF sums its rank
      // contributions with the other channels' rather than duplicating rows.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chunkRows = (chunkResult.data || []).map((r: any) => ({ ...r, match_type: 'chunk' }))

      // Relevance floor on the SEMANTIC channels only (lib/relevance.ts in
      // @tages/shared). Measured: the RPCs' absolute `p_threshold` does not
      // filter anything against this embedding model — pure nonsense scores
      // 0.775 and "best recipe for sourdough bread" scores 0.725, both clearing
      // the 0.7 default. So `tages recall <anything>` returned the whole
      // project, and an agent got irrelevant memories presented as answers.
      //
      // Scoped to semantic/chunk deliberately: the trigram channel already has
      // a real floor (measured 0 rows for the same nonsense queries), so it
      // needs no help and must not be second-guessed. If the semantic
      // distribution is flat AND low, that channel contributes nothing and
      // fusion proceeds on trigram alone — which for a genuinely unanswerable
      // query means no results at all, the correct answer.
      const semanticJudged = judgeRelevance(semanticRows.map((r: { similarity?: unknown }) => Number(r.similarity)))
      const chunkJudged = judgeRelevance(chunkRows.map((r: { similarity?: unknown }) => Number(r.similarity)))
      if (process.env.TAGES_DEBUG_RECALL === '1') {
        console.error(
          `[tages] relevance semantic=${semanticJudged.reason} (top=${semanticJudged.top.toFixed(3)} z=${semanticJudged.z.toFixed(2)}) ` +
            `chunk=${chunkJudged.reason} (top=${chunkJudged.top.toFixed(3)} z=${chunkJudged.z.toFixed(2)})`,
        )
      }

      const merged = reciprocalRankFusion<Record<string, unknown> & { id: string }>([
        semanticJudged.relevant ? semanticRows : [],
        chunkJudged.relevant ? chunkRows : [],
        trigramRows,
        temporalTagged,
      ])

      // Drop near-duplicate content (e.g. two overlapping long-session chunks
      // that both cleared threshold), keeping the higher-ranked occurrence.
      // Runs after RRF fusion and before rerank/temporal reordering.
      const contentDeduped = dedupeNearDuplicateContent(merged)

      // Evidence weighting (migration 0070). Applied HERE and not only in the
      // MCP server: this is a separate ranking implementation, and without it
      // `tages recall` ordered purely on lexical/semantic fit — so an inferred
      // guess that happened to match the query better outranked the verified
      // fact answering the same question, which is precisely what the field
      // exists to prevent. Measured end to end before this was added.
      //
      // A stable sort on the weight alone: RRF has already produced the
      // relevance order, and this only reorders WITHIN that, so a strongly
      // relevant inferred row still beats an irrelevant verified one.
      // The four recall RPCs return a fixed table shape that predates 0070 and
      // does not carry `evidence`, so the fused rows arrive without it. Widening
      // those return types means DROP + CREATE on four SECURITY DEFINER
      // functions that 0066, 0068 and 0072 have each already had to patch — a
      // large blast radius for a display/ordering field. One supplementary
      // lookup keyed on the candidate ids is cheaper and carries no RLS risk:
      // it goes through the ordinary `memories` table policy, so a row the
      // caller may not read simply comes back absent and stays unweighted.
      const evidenceById = await fetchEvidenceLevels(supabase, contentDeduped.map((r) => r.id as string))
      for (const row of contentDeduped) {
        const level = evidenceById.get(row.id as string)
        if (level) row.evidence = level
      }
      const evidenceOrdered = stableSortByEvidence(contentDeduped)

      // Cross-encoder rerank pass (Task 2): only the top RERANK_WINDOW rows
      // are sent to the reranker; rows beyond that window keep their RRF
      // order, appended after the reranked subset.
      let reranked = evidenceOrdered
      if (evidenceOrdered.length > 0) {
        const window = evidenceOrdered.slice(0, RERANK_WINDOW)
        const rest = evidenceOrdered.slice(RERANK_WINDOW)
        const rerankedIds = await rerankCandidates(
          query!,
          window.map((row) => ({ id: row.id as string, text: (row.value as string) || '' })),
          window.length,
        )
        const byId = new Map(window.map((row) => [row.id as string, row]))
        const rerankedWindow = rerankedIds
          .map((id) => byId.get(id))
          .filter((row): row is Record<string, unknown> => row !== undefined)
        // Fail-safe: if the reranker returned an unexpected id set (fewer ids
        // than the window it was given), fall back to the original RRF order
        // rather than silently dropping rows.
        reranked = rerankedWindow.length === window.length ? [...rerankedWindow, ...rest] : evidenceOrdered
      }

      // Temporal anchoring (migration 0060): when the query is asking about
      // timing rather than content, reorder by date proximity/recency on top
      // of the fused/reranked ordering above. Only semantic_recall/temporal
      // rows carry referenced_date/relative_date (recall_memories/trigram
      // rows fall back to created_at, which every row has) — see 0060's
      // migration header for why only hybrid_recall/semantic_recall were
      // updated.
      const temporallySorted = sortByTemporalProximity(reranked, query!)
      assembledPool = temporallySorted
      data = temporallySorted.slice(0, limit)

      if (semanticResult.data === null) searchMethod = 'trigram'
    }

    if (!data || data.length === 0) {
      console.log(chalk.dim(`No memories found matching "${query}".`))
      return
    }

    // Budget-fitted, chronologically-ordered assembled-context output
    // (Task 4), opt-in via --assembled-context. The default (flag-absent)
    // path below this branch is completely unchanged, so the harness's
    // default-mode `tages recall` output (and parseRecallKeys) is untouched.
    if (options.assembledContext) {
      printAssembledContext(assembledPool ?? data, limit)
      return
    }

    console.log(chalk.bold(`Found ${data.length} memories`) + chalk.dim(` (${searchMethod}):\n`))
    for (const row of data) {
      const typeColor = getTypeColor(row.type as string)
      console.log(`  ${typeColor((row.type as string).padEnd(12))} ${chalk.bold(row.key as string)}${formatEvidence(row.evidence)}`)
      console.log(`  ${chalk.dim('             ')}${row.value}`)
      if (row.similarity !== undefined && row.similarity !== null) {
        const matchType = row.match_type ? ` [${row.match_type}]` : ''
        console.log(`  ${chalk.dim('             ')}${chalk.dim(`similarity: ${(row.similarity as number).toFixed(2)}${matchType}`)}`)
      }
      // Temporal anchoring (migration 0060): mirror the server's
      // formatMemoryBody (packages/server/src/tools/recall.ts) so CLI users
      // see the same extracted dates MCP-driven agents already get.
      if (row.referenced_date || row.relative_date) {
        const dateBits: string[] = []
        if (row.referenced_date) dateBits.push(`referenced ${(row.referenced_date as string).slice(0, 10)}`)
        if (row.relative_date) dateBits.push(`relative ${(row.relative_date as string).slice(0, 10)}`)
        console.log(`  ${chalk.dim('             ')}${chalk.dim(`Dates: ${dateBits.join(', ')}`)}`)
      }
      console.log()
    }
  } else {
    // Local-only mode: use SQLite cache
    const dbPath = `${getCacheDir()}/${config.slug || config.projectId}.db`
    if (!fs.existsSync(dbPath)) {
      console.log(chalk.dim('No local memories yet. Run `tages remember` to store your first memory.'))
      return
    }
    const db = new Database(dbPath, { readonly: true })
    let rows: Array<{ key: string; value: string; type: string }>

    if (listAll) {
      let stmt
      if (options.type) {
        stmt = db.prepare(`SELECT * FROM memories WHERE project_id = ? AND type = ? AND status = 'live' ORDER BY type, key LIMIT 200`)
        stmt = stmt.bind(config.projectId, options.type)
      } else {
        stmt = db.prepare(`SELECT * FROM memories WHERE project_id = ? AND status = 'live' ORDER BY type, key LIMIT 200`)
        stmt = stmt.bind(config.projectId)
      }
      rows = stmt.all() as Array<{ key: string; value: string; type: string }>
    } else {
      const queryLower = `%${query!.toLowerCase()}%`
      let stmt
      if (options.type) {
        stmt = db.prepare(`SELECT * FROM memories WHERE project_id = ? AND type = ? AND status = 'live' AND (LOWER(key) LIKE ? OR LOWER(value) LIKE ? OR LOWER(type) LIKE ? OR LOWER(tags) LIKE ?) ORDER BY updated_at DESC LIMIT ?`)
        stmt = stmt.bind(config.projectId, options.type, queryLower, queryLower, queryLower, queryLower, limit)
      } else {
        stmt = db.prepare(`SELECT * FROM memories WHERE project_id = ? AND status = 'live' AND (LOWER(key) LIKE ? OR LOWER(value) LIKE ? OR LOWER(type) LIKE ? OR LOWER(tags) LIKE ?) ORDER BY updated_at DESC LIMIT ?`)
        stmt = stmt.bind(config.projectId, queryLower, queryLower, queryLower, queryLower, limit)
      }
      rows = stmt.all() as Array<{ key: string; value: string; type: string }>
    }
    db.close()

    if (rows.length === 0) {
      console.log(chalk.dim(`No memories found matching "${query}".`))
      return
    }

    const modeLabel = listAll ? 'all, local SQLite' : 'local SQLite'
    console.log(chalk.bold(`Found ${rows.length} memories`) + chalk.dim(` (${modeLabel}):\n`))
    for (const row of rows) {
      const typeColor = getTypeColor(row.type)
      console.log(`  ${typeColor(row.type.padEnd(12))} ${chalk.bold(row.key)}${formatEvidence((row as { evidence?: string }).evidence)}`)
      console.log(`  ${chalk.dim('             ')}${row.value}`)
      console.log()
    }
  }
}

/**
 * Render the evidence level for a result line (migration 0070).
 *
 * Mirrors the server's formatPassage so CLI users and MCP-driven agents see the
 * same signal. Empty when unknown — every row written before 0070 has no
 * assessment behind it, and printing a label implies one was made. `disputed`
 * is shouted in red, because a contradicted claim rendered as a plain fact is
 * worse than no memory at all.
 */
function formatEvidence(evidence: unknown): string {
  if (typeof evidence !== 'string' || !evidence) return ''
  if (evidence === 'disputed') {
    return `  ${chalk.red.bold('DISPUTED')}${chalk.red(' — contradicted, re-check before acting')}`
  }
  return `  ${chalk.dim(`evidence: ${evidence}`)}`
}

/**
 * Reorder a relevance-ranked list so better-established claims come first,
 * without discarding the relevance ordering (migration 0070).
 *
 * Stable, and applied AFTER fusion: it only reorders rows that RRF already
 * considered comparable, so a highly relevant `inferred` memory still outranks
 * an irrelevant `verified` one. What it prevents is the case the end-to-end
 * suite caught — two memories answering the SAME question, where the guess
 * happened to match the query text slightly better and was therefore served
 * first to the agent.
 *
 * Rows with no level (everything written before 0070) sort at the neutral
 * weight, so an existing corpus is neither promoted nor buried.
 */
/**
 * Look up evidence levels for a set of memory ids (migration 0070).
 *
 * Returns an empty map on any failure — a missing level must degrade to
 * "unweighted", never break a recall the user asked for.
 */
async function fetchEvidenceLevels(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  try {
    const { data } = await supabase.from('memories').select('id, evidence').in('id', ids)
    for (const row of (data || []) as Array<{ id: string; evidence: string | null }>) {
      if (row.evidence) out.set(row.id, row.evidence)
    }
  } catch {
    // Unweighted ordering is a degradation, not a failure.
  }
  return out
}

function stableSortByEvidence<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, weight: evidenceWeight(row.evidence as EvidenceLevel | undefined) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.row)
}

function getTypeColor(type: string) {
  const colors: Record<string, (s: string) => string> = {
    convention: chalk.blue,
    decision: chalk.magenta,
    architecture: chalk.green,
    entity: chalk.yellow,
    lesson: chalk.cyan,
    preference: chalk.gray,
    pattern: chalk.white,
    execution: chalk.red,
    operational: chalk.yellowBright,
    environment: chalk.blueBright,
  }
  return colors[type] || chalk.white
}

