import * as fs from 'fs'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir } from '../config/paths.js'

interface RecallOptions {
  type?: string
  limit?: string
  project?: string
  all?: boolean
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
        .select('id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, conditions, phases, cross_system_refs, examples, execution_flow, created_at, updated_at')
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

      // Semantic search (if Ollama available)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let semanticPromise: any = Promise.resolve({ data: null, error: null })
      try {
        const embedRes = await fetch('http://localhost:11434/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: query }),
          signal: AbortSignal.timeout(3000),
        })

        if (embedRes.ok) {
          const embedData = await embedRes.json() as { embedding: number[] }
          let embedding = embedData.embedding
          if (embedding.length < 1536) embedding = [...embedding, ...new Array(1536 - embedding.length).fill(0)]
          const embeddingStr = `[${embedding.join(',')}]`

          semanticPromise = supabase.rpc('semantic_recall', {
            p_project_id: config.projectId,
            p_embedding: embeddingStr,
            p_type: options.type || null,
            p_limit: limit,
            p_threshold: 0.3,
          })
          searchMethod = 'hybrid (trigram + semantic)'
        }
      } catch {
        // Ollama not available
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
      data = merged.slice(0, limit)

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
      if (row.similarity) {
        const matchType = row.match_type ? ` [${row.match_type}]` : ''
        console.log(`  ${chalk.dim('             ')}${chalk.dim(`similarity: ${(row.similarity as number).toFixed(2)}${matchType}`)}`)
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

