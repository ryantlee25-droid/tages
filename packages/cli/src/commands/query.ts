import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface QueryOptions {
  project?: string
}

export async function queryCommand(question: string, options: QueryOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Query requires cloud connection.'))
    process.exit(1)
  }

  const spinner = ora('Searching memories...').start()
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data, error } = await supabase.rpc('recall_memories', {
    p_project_id: config.projectId,
    p_query: question,
    p_type: null,
    p_limit: 5,
  })

  if (error || !data || data.length === 0) {
    spinner.info('No relevant memories found.')
    return
  }

  // Try LLM-powered answer if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    spinner.text = 'Generating answer...'

    const memoriesText = data
      .map((m: { key: string; value: string; type: string }) => `[${m.type}] ${m.key}: ${m.value}`)
      .join('\n')

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `Given these memories about this codebase, answer the question concisely: ${question}\n\nMemories:\n${memoriesText}`,
          }],
        }),
      })

      if (response.ok) {
        const result = await response.json() as {
          content: Array<{ type: string; text: string }>
        }
        const answer = result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('')

        spinner.stop()
        console.log()
        console.log(chalk.white(answer))
        console.log()
        console.log(chalk.dim('Sources:'))
        for (const m of data) {
          console.log(chalk.dim(`  [${m.type}] ${m.key}`))
        }
        return
      }
    } catch {
      // Fall through to raw results
    }
  }

  // Fallback: print raw recall results
  spinner.stop()
  console.log()
  console.log(chalk.bold(`Found ${data.length} relevant memories:\n`))
  for (const row of data) {
    console.log(`  ${chalk.dim(row.type.padEnd(14))} ${chalk.bold(row.key)}`)
    console.log(`  ${chalk.dim('               ')}${row.value}`)
    if (row.similarity) {
      console.log(`  ${chalk.dim('               ')}${chalk.dim(`similarity: ${(row.similarity as number).toFixed(2)}`)}`)
    }
    console.log()
  }
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
