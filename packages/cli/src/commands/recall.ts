import * as fs from 'fs'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir } from '../config/paths.js'
import { generateEmbedding } from '../lib/embedding.js'
import { sortByTemporalProximity } from '../lib/temporal-sort.js'

interface RecallOptions {
  type?: string
  limit?: string
  project?: string
  all?: boolean
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

    if (listAll) {
      // List all memories — no similarity filtering
      let q = supabase
        .from('memories')
        .select('id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, conditions, phases, cross_system_refs, examples, execution_flow, created_at, updated_at, referenced_date, relative_date')
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
      searchMethod = 'all'
    } else {
      // Hybrid search: run trigram + semantic in parallel, merge & deduplicate

      // Trigram search
      const trigramPromise = supabase.rpc('recall_memories', {
        p_project_id: config.projectId,
        p_query: query,
        p_type: options.type || null,
        p_limit: limit,
      })

      // Semantic search. Uses Ollama only by default: if the local embedder is
      // down, generateEmbedding returns null and we fail fast to trigram rather
      // than making a blocking, billable OpenAI call on the recall hot path.
      // The OpenAI fallback is opt-in via TAGES_OPENAI_EMBED (see lib/embedding).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let semanticPromise: any = Promise.resolve({ data: null, error: null })
      const embedding = await generateEmbedding(query!)
      if (embedding) {
        const embeddingStr = `[${embedding.join(',')}]`

        semanticPromise = supabase.rpc('semantic_recall', {
          p_project_id: config.projectId,
          p_embedding: embeddingStr,
          p_type: options.type || null,
          p_limit: limit,
          p_threshold: getRecallThreshold(),
        })
        searchMethod = 'hybrid (trigram + semantic)'
      }

      const [trigramResult, semanticResult] = await Promise.all([trigramPromise, semanticPromise])

      if (trigramResult.error) {
        console.error(chalk.red(`Recall failed: ${trigramResult.error.message}`))
        process.exit(1)
      }

      // Merge and deduplicate: semantic results first (usually more relevant), then trigram
      const seen = new Set<string>()
      const merged: Record<string, unknown>[] = []

      for (const r of (semanticResult.data || [])) {
        const id = r.id as string
        if (!seen.has(id)) {
          seen.add(id)
          merged.push({ ...r, match_type: 'semantic' })
        }
      }
      for (const r of (trigramResult.data || [])) {
        const id = r.id as string
        if (!seen.has(id)) {
          seen.add(id)
          merged.push({ ...r, match_type: 'trigram' })
        }
      }

      // Sort by similarity desc, take top N
      merged.sort((a, b) => ((b.similarity as number) || 0) - ((a.similarity as number) || 0))
      // Drop near-duplicate content (e.g. two overlapping long-session chunks
      // that both cleared threshold), keeping the higher-ranked occurrence.
      // Runs after the by-id dedup/sort above and before temporal reordering.
      const contentDeduped = dedupeNearDuplicateContent(merged)
      // Temporal anchoring (migration 0060): when the query is asking about
      // timing rather than content, reorder by date proximity/recency on top
      // of the similarity ordering above. Only semantic_recall rows carry
      // referenced_date/relative_date (recall_memories/trigram rows fall back
      // to created_at, which every row has) — see 0060's migration header for
      // why only hybrid_recall/semantic_recall were updated.
      const temporallySorted = sortByTemporalProximity(contentDeduped, query!)
      data = temporallySorted.slice(0, limit)

      if (semanticResult.data === null) searchMethod = 'trigram'
    }

    if (!data || data.length === 0) {
      console.log(chalk.dim(`No memories found matching "${query}".`))
      return
    }

    console.log(chalk.bold(`Found ${data.length} memories`) + chalk.dim(` (${searchMethod}):\n`))
    for (const row of data) {
      const typeColor = getTypeColor(row.type as string)
      console.log(`  ${typeColor((row.type as string).padEnd(12))} ${chalk.bold(row.key as string)}`)
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
      console.log(`  ${typeColor(row.type.padEnd(12))} ${chalk.bold(row.key)}`)
      console.log(`  ${chalk.dim('             ')}${row.value}`)
      console.log()
    }
  }
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

