import chalk from 'chalk'
import open from 'open'
import { loadProjectConfig } from '../config/project.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://app.tages.ai'

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
