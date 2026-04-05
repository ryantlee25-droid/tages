import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface RecallOptions {
  type?: string
  limit?: string
  project?: string
}

export async function recallCommand(query: string, options: RecallOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const limit = options.limit ? parseInt(options.limit, 10) : 5

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

    // Hybrid search: run trigram + semantic in parallel, merge & deduplicate
    let data: Record<string, unknown>[] | null = null
    let searchMethod = 'trigram'

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
    console.error(chalk.yellow('No Supabase config — recall requires cloud connection.'))
    console.log(chalk.dim('Run `tages init` to configure cloud sync.'))
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
  }
  return colors[type] || chalk.white
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
