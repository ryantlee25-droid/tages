import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getConfigDir, getProjectsDir, getCacheDir, getAuthPath } from '../config/paths.js'
import { injectMcpConfig } from '../config/mcp-inject.js'
import { runGithubOAuth } from '../auth/github-oauth.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://tages.dev'
const SUPABASE_URL = process.env.TAGES_SUPABASE_URL || 'https://wezagdgpvwfywjoxztfs.supabase.co'
const SUPABASE_ANON_KEY = process.env.TAGES_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlemFnZGdwdndmeXdqb3h6dGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcyNTAsImV4cCI6MjA5MDkyMzI1MH0.iMJ3gnt0w104QxzEaTLJsAYVciPDFJvAzOtIU5tofG0'

interface InitOptions {
  local?: boolean
  slug?: string
}

export async function initCommand(options: InitOptions) {
  const spinner = ora()
  const slug = options.slug || path.basename(process.cwd())

  // Ensure config directories exist
  const dirs = [getConfigDir(), getProjectsDir(), getCacheDir()]
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

  // Default: Cloud mode — OAuth → create project → save config → init cache
  spinner.start('Opening browser for GitHub authentication...')

  let accessToken: string
  let refreshToken: string
  let userId: string

  try {
    const auth = await runGithubOAuth(DASHBOARD_URL)
    accessToken = auth.accessToken
    refreshToken = auth.refreshToken
    userId = auth.userId
    spinner.succeed('Authenticated with GitHub')
  } catch (err) {
    spinner.fail('Authentication failed')
    console.error(chalk.red(`  ${(err as Error).message}`))
    process.exit(1)
  }

  // Save auth credentials
  const authData = { accessToken, refreshToken, userId }
  fs.writeFileSync(getAuthPath(), JSON.stringify(authData, null, 2) + '\n', { mode: 0o600 })

  // Create or find project in Supabase
  spinner.start('Setting up project...')

  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  // Set the session so RLS works for this user
  await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })

  // Check if project already exists for this user
  const { data: existingProjects } = await supabase
    .from('projects')
    .select('id, slug, name')
    .eq('slug', slug)
    .eq('owner_id', userId)

  let projectId: string

  if (existingProjects && existingProjects.length > 0) {
    // Project already exists — reuse it
    projectId = existingProjects[0].id as string
    spinner.succeed(`Found existing project: ${existingProjects[0].name}`)
  } else {
    // Create new project
    const { data: newProject, error: createError } = await supabase
      .from('projects')
      .insert({
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        slug,
        owner_id: userId,
        default_branch: 'main',
      })
      .select('id')
      .single()

    if (createError || !newProject) {
      spinner.fail('Failed to create project')
      console.error(chalk.red(`  ${createError?.message || 'Unknown error'}`))
      console.log(chalk.dim('  Try `tages init --local` for local-only mode.'))
      process.exit(1)
    }

    projectId = newProject.id as string
    spinner.succeed(`Created project: ${slug}`)
  }

  // Save project config with real Supabase credentials
  const projectConfig = {
    projectId,
    slug,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  }

  const projectPath = path.join(getProjectsDir(), `${slug}.json`)
  fs.writeFileSync(projectPath, JSON.stringify(projectConfig, null, 2) + '\n', { mode: 0o600 })

  // Inject MCP config with real credentials
  const { path: mcpPath, created } = injectMcpConfig({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    projectId,
    projectSlug: slug,
  })

  console.log()
  console.log(chalk.green('  Auth saved:'), getAuthPath())
  console.log(chalk.green('  Project config:'), projectPath)
  console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
  console.log()
  console.log(chalk.bold('  Tages is ready!'))
  console.log(chalk.dim('  Your AI tools will now remember this codebase across sessions.'))
  console.log(chalk.dim('  Memories sync to cloud with local SQLite cache for speed.'))
}
