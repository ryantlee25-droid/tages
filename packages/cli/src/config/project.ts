import * as fs from 'fs'
import chalk from 'chalk'
import { getProjectsDir } from './paths.js'

/**
 * Loads a project config from ~/.config/tages/projects/<slug>.json.
 * When no slug is given, picks the first .json file alphabetically.
 *
 * Returns null if no project is configured.
 * Exits with a friendly error if the config file is corrupt.
 */
export function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch {
      console.error(chalk.red(`Config file corrupted: ${p}`))
      console.error(chalk.dim('Run `tages init` to reconfigure.'))
      process.exit(1)
    }
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  const p = `${dir}/${files[0]}`
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    console.error(chalk.red(`Config file corrupted: ${p}`))
    console.error(chalk.dim('Run `tages init` to reconfigure.'))
    process.exit(1)
  }
}
