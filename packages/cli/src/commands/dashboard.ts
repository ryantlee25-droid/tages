import * as fs from 'fs'
import chalk from 'chalk'
import open from 'open'
import { getProjectsDir } from '../config/paths.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://tages.dev'

interface DashboardOptions {
  project?: string
}

export async function dashboardCommand(options: DashboardOptions) {
  const config = loadProjectConfig(options.project)

  const url = config
    ? `${DASHBOARD_URL}/app/projects/${config.slug}`
    : DASHBOARD_URL

  console.log(chalk.dim(`  Opening ${url}...`))
  await open(url)
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
