import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { getConfigDir, getProjectsDir, getAuthPath } from '../config/paths.js'
import { injectMcpConfig } from '../config/mcp-inject.js'
import { runGithubOAuth } from '../auth/github-oauth.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://tages.dev'

interface InitOptions {
  local?: boolean
  slug?: string
}

export async function initCommand(options: InitOptions) {
  const spinner = ora()
  const slug = options.slug || path.basename(process.cwd())

  // Ensure config directories exist
  const dirs = [getConfigDir(), getProjectsDir()]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  if (options.local) {
    // Local-only mode: no Supabase, no auth
    spinner.start('Setting up local-only mode...')

    const projectConfig = {
      projectId: `local-${slug}`,
      slug,
      supabaseUrl: '',
      supabaseAnonKey: '',
    }

    const projectPath = path.join(getProjectsDir(), `${slug}.json`)
    fs.writeFileSync(projectPath, JSON.stringify(projectConfig, null, 2) + '\n', { mode: 0o600 })

    // Inject MCP config
    const { path: mcpPath, created } = injectMcpConfig({
      projectId: projectConfig.projectId,
      projectSlug: slug,
    })

    spinner.succeed('Local-only mode configured')
    console.log()
    console.log(chalk.green('  Project config:'), projectPath)
    console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
    console.log()
    console.log(chalk.dim('  Memories will be stored locally only (no cloud sync).'))
    console.log(chalk.dim('  Run `tages remember` to store your first memory.'))
    return
  }

  // Cloud mode: run OAuth
  spinner.start('Opening browser for GitHub authentication...')

  try {
    const { accessToken, refreshToken, userId } = await runGithubOAuth(DASHBOARD_URL)
    spinner.succeed('Authenticated with GitHub')

    // Save auth
    const authData = { accessToken, refreshToken, userId }
    fs.writeFileSync(getAuthPath(), JSON.stringify(authData, null, 2) + '\n', { mode: 0o600 })

    // Save project config
    // In a real flow, we'd call the API to create/get the project
    const projectConfig = {
      projectId: userId, // placeholder; real impl would get from API
      slug,
      supabaseUrl: process.env.TAGES_SUPABASE_URL || '',
      supabaseAnonKey: process.env.TAGES_SUPABASE_ANON_KEY || '',
    }

    const projectPath = path.join(getProjectsDir(), `${slug}.json`)
    fs.writeFileSync(projectPath, JSON.stringify(projectConfig, null, 2) + '\n', { mode: 0o600 })

    // Inject MCP config
    const { path: mcpPath, created } = injectMcpConfig({
      supabaseUrl: projectConfig.supabaseUrl,
      supabaseAnonKey: projectConfig.supabaseAnonKey,
      projectId: projectConfig.projectId,
      projectSlug: slug,
    })

    console.log()
    console.log(chalk.green('  Auth saved:'), getAuthPath())
    console.log(chalk.green('  Project config:'), projectPath)
    console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
    console.log()
    console.log(chalk.bold('  Tages is ready!'))
    console.log(chalk.dim('  Your AI tools will now remember this codebase across sessions.'))
  } catch (err) {
    spinner.fail('Authentication failed')
    console.error(chalk.red(`  ${(err as Error).message}`))
    process.exit(1)
  }
}
