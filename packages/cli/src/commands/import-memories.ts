import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { getProjectsDir } from '../config/paths.js'
// @ts-ignore — cross-package import; server must be built first
import { SqliteCache } from '../../../server/src/cache/sqlite.js'
// @ts-ignore — cross-package import; server must be built first
import { handleImport } from '../../../server/src/tools/import.js'

interface ImportMemoriesOptions {
  format?: string
  strategy?: string
  project?: string
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}

export async function importMemoriesCommand(filePath: string, options: ImportMemoriesOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`File not found: ${filePath}`))
    process.exit(1)
  }

  const spinner = ora(`Reading ${filePath}...`).start()

  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    spinner.fail(`Could not read file: ${(err as Error).message}`)
    process.exit(1)
  }

  if (!content.trim()) {
    spinner.warn('File is empty — nothing to import.')
    return
  }

  const strategy = (options.strategy || 'skip') as 'skip' | 'overwrite' | 'merge'
  const format = (options.format || 'auto') as 'json' | 'markdown' | 'auto'

  spinner.text = 'Importing memories...'

  const cachePath = config.cachePath || `/tmp/tages-${config.projectId}.db`
  const cache = new SqliteCache(cachePath)

  try {
    const { result, content: output } = await handleImport(
      { content, format, strategy, projectId: config.projectId },
      cache, null,
    )

    if (result.errors.length > 0) {
      spinner.warn(`Completed with ${result.errors.length} error(s)`)
      for (const err of result.errors) {
        console.log(chalk.dim(`  - ${err}`))
      }
    } else {
      spinner.succeed(output[0].text.replace('## Import Complete\n', ''))
    }

    console.log()
    console.log(`  ${chalk.green('Imported:')} ${result.imported}`)
    console.log(`  ${chalk.yellow('Skipped:')}  ${result.skipped}`)
    console.log(`  ${chalk.blue('Merged:')}   ${result.merged}`)
  } finally {
    cache.close()
  }
}
