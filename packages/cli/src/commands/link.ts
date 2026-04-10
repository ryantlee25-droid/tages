import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { getProjectsDir } from '../config/paths.js'

export async function linkCommand(slug?: string) {
  const targetSlug = slug || path.basename(process.cwd())

  // Check if this slug is a registered project
  const projectsDir = getProjectsDir()
  const configPath = path.join(projectsDir, `${targetSlug}.json`)

  if (!fs.existsSync(configPath)) {
    // List available projects for help
    const available = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir)
          .filter(f => f.endsWith('.json') && !f.endsWith('.bak'))
          .map(f => f.replace('.json', ''))
      : []

    console.error(chalk.red(`  No registered project found for slug '${targetSlug}'.`))
    if (available.length > 0) {
      console.error(chalk.dim(`  Available projects: ${available.join(', ')}`))
    }
    console.error(chalk.dim(`  Run 'tages init' to create a new project first.`))
    process.exit(1)
  }

  // Write .tages/config.json marker in current directory
  const tagesDir = path.join(process.cwd(), '.tages')
  if (!fs.existsSync(tagesDir)) {
    fs.mkdirSync(tagesDir, { recursive: true })
  }

  const markerPath = path.join(tagesDir, 'config.json')
  fs.writeFileSync(markerPath, JSON.stringify({ slug: targetSlug }, null, 2) + '\n')

  console.log(chalk.green(`  Linked this directory to project '${targetSlug}'.`))
  console.log(chalk.dim(`  Wrote ${markerPath}`))
  console.log(chalk.dim(`  The MCP server will now auto-detect this project when started here.`))
}
