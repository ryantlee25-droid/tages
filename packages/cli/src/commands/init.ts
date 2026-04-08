import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getConfigDir, getProjectsDir, getCacheDir, getAuthPath } from '../config/paths.js'
import { injectMcpConfig } from '../config/mcp-inject.js'
import { runGithubOAuth } from '../auth/github-oauth.js'
import { installPostCommitHook } from '../indexer/install-hook.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://tages.dev'
const SUPABASE_URL = process.env.TAGES_SUPABASE_URL || 'https://wezagdgpvwfywjoxztfs.supabase.co'
const SUPABASE_ANON_KEY = process.env.TAGES_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlemFnZGdwdndmeXdqb3h6dGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcyNTAsImV4cCI6MjA5MDkyMzI1MH0.iMJ3gnt0w104QxzEaTLJsAYVciPDFJvAzOtIU5tofG0'

interface InitOptions {
  local?: boolean   // opt-out of cloud mode; use local-only mode
  cloud?: boolean   // backward compat alias; same as default (no flags)
  team?: boolean    // implies cloud, adds teammate invites after project creation
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

  if (options.team) {
    // Team mode implies cloud — fall through to OAuth flow
    options.cloud = true
  }

  if (options.local) {
    // Local-only mode (--local flag): no Supabase, no auth required
    spinner.start('Setting up local mode...')

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

    // Install post-commit hook for auto-indexing
    const { installed: hookInstalled, path: hookPath } = installPostCommitHook()

    spinner.succeed('Local mode configured')
    console.log()
    console.log(chalk.green('  Project config:'), projectPath)
    console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
    if (hookInstalled) {
      console.log(chalk.green('  Git hook:'), hookPath)
    }
    console.log()
    console.log(chalk.bold('  Tages is ready!'))
    console.log(chalk.dim('  Memories are stored locally. Run `tages init` (without --local) to enable cloud sync.'))
    console.log(chalk.dim('  Run `tages remember` to store your first memory.'))
    return
  }

  // Cloud mode (--cloud flag): OAuth → create project → save config → init cache
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
      console.log(chalk.dim('  Cloud sync unavailable. Run `tages init --local` for local-only mode.'))
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

  // Install post-commit hook for auto-indexing
  const { installed: hookInstalled, path: hookPath } = installPostCommitHook()

  console.log()
  console.log(chalk.green('  Auth saved:'), getAuthPath())
  console.log(chalk.green('  Project config:'), projectPath)
  console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
  if (hookInstalled) {
    console.log(chalk.green('  Git hook:'), hookPath)
  }
  console.log()
  console.log(chalk.bold('  Tages is ready!'))
  console.log(chalk.dim('  Your AI tools will now remember this codebase across sessions.'))
  console.log(chalk.dim('  Memories sync to cloud with local SQLite cache for speed.'))

  if (options.team) {
    // Prompt for teammate emails
    const { createInterface } = await import('readline/promises')
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const emailInput = await rl.question('\n  Enter teammate emails (comma-separated): ')
    rl.close()

    const emails = emailInput.split(',').map((e: string) => e.trim()).filter(Boolean)

    if (emails.length > 0) {
      const { inviteTeamMembers } = await import('../auth/invite.js')
      const result = await inviteTeamMembers(supabase, projectId, emails)

      if (result.invited.length > 0) {
        console.log()
        console.log(chalk.green(`  Invited ${result.invited.length} teammate(s):`))
        for (const email of result.invited) {
          console.log(chalk.dim(`    ${email}`))
        }
      }

      if (result.failed.length > 0) {
        console.log()
        console.log(chalk.yellow(`  Failed to invite ${result.failed.length} email(s):`))
        for (const { email, error } of result.failed) {
          console.log(chalk.dim(`    ${email}: ${error}`))
        }
      }
    }

    // Print MCP config snippet for teammates
    console.log(chalk.bold('\n  Share this with your teammates:\n'))
    console.log(chalk.cyan('  claude mcp add tages -- npx -y @tages/server'))
    console.log(chalk.dim('\n  # Environment variables for team members:'))
    console.log(chalk.dim(`  TAGES_PROJECT_ID=${projectId}`))
    console.log(chalk.dim(`  TAGES_PROJECT_SLUG=${slug}`))
    console.log(chalk.dim(`  TAGES_SUPABASE_URL=${SUPABASE_URL}`))
    console.log(chalk.dim(`  TAGES_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}`))
  }
}
