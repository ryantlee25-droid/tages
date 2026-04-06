import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import Database from 'better-sqlite3'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getProjectsDir, getCacheDir, getAuthPath } from '../config/paths.js'
import { runGithubOAuth } from '../auth/github-oauth.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://tages.dev'
const SUPABASE_URL = process.env.TAGES_SUPABASE_URL || 'https://wezagdgpvwfywjoxztfs.supabase.co'
const SUPABASE_ANON_KEY = process.env.TAGES_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlemFnZGdwdndmeXdqb3h6dGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcyNTAsImV4cCI6MjA5MDkyMzI1MH0.iMJ3gnt0w104QxzEaTLJsAYVciPDFJvAzOtIU5tofG0'

interface MigrateOptions {
  project?: string
}

export async function migrateCommand(options: MigrateOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (config.supabaseUrl && config.supabaseAnonKey) {
    console.log(chalk.yellow('This project is already in cloud mode.'))
    return
  }

  const spinner = ora()

  // Check for local memories
  const dbPath = `${getCacheDir()}/${config.slug || config.projectId}.db`
  if (!fs.existsSync(dbPath)) {
    console.log(chalk.dim('No local memories to migrate. Run `tages init` to switch to cloud mode.'))
    return
  }

  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare("SELECT * FROM memories WHERE status = 'live'").all() as Array<Record<string, unknown>>
  db.close()

  console.log(chalk.bold(`\n  Found ${rows.length} local memories to migrate.\n`))

  // Authenticate
  const authPath = getAuthPath()
  let accessToken: string
  let refreshToken: string
  let userId: string

  if (fs.existsSync(authPath)) {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    accessToken = auth.accessToken
    refreshToken = auth.refreshToken
    userId = auth.userId
    console.log(chalk.dim('  Using existing auth credentials.'))
  } else {
    spinner.start('Opening browser for GitHub authentication...')
    try {
      const auth = await runGithubOAuth(DASHBOARD_URL)
      accessToken = auth.accessToken
      refreshToken = auth.refreshToken
      userId = auth.userId
      spinner.succeed('Authenticated')

      fs.writeFileSync(authPath, JSON.stringify({ accessToken, refreshToken, userId }, null, 2) + '\n', { mode: 0o600 })
    } catch (err) {
      spinner.fail('Authentication failed')
      console.error(chalk.red(`  ${(err as Error).message}`))
      process.exit(1)
    }
  }

  // Create or find project in Supabase
  spinner.start('Setting up cloud project...')
  const supabase = await createAuthenticatedClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })

  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', config.slug)
    .eq('owner_id', userId)

  let projectId: string

  if (existing && existing.length > 0) {
    projectId = existing[0].id as string
    spinner.succeed('Found existing cloud project')
  } else {
    const { data: newProject, error } = await supabase
      .from('projects')
      .insert({
        name: config.slug.charAt(0).toUpperCase() + config.slug.slice(1),
        slug: config.slug,
        owner_id: userId,
        default_branch: 'main',
      })
      .select('id')
      .single()

    if (error || !newProject) {
      spinner.fail(`Failed to create project: ${error?.message || 'unknown'}`)
      process.exit(1)
    }
    projectId = newProject.id as string
    spinner.succeed('Created cloud project')
  }

  // Upload memories
  spinner.start(`Uploading ${rows.length} memories...`)

  const records = rows.map(r => ({
    project_id: projectId,
    key: r.key as string,
    value: r.value as string,
    type: r.type as string,
    source: r.source as string || 'manual',
    file_paths: r.file_paths ? JSON.parse(r.file_paths as string) : [],
    tags: r.tags ? JSON.parse(r.tags as string) : [],
    confidence: (r.confidence as number) || 1.0,
    status: 'live',
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }))

  // Batch insert (Supabase handles upsert)
  const { error: insertError } = await supabase
    .from('memories')
    .upsert(records, { onConflict: 'project_id,key' })

  if (insertError) {
    spinner.fail(`Upload failed: ${insertError.message}`)
    process.exit(1)
  }

  spinner.succeed(`Uploaded ${rows.length} memories to cloud`)

  // Update local config
  const projectConfig = {
    projectId,
    slug: config.slug,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  }

  const projectPath = `${getProjectsDir()}/${config.slug}.json`
  fs.writeFileSync(projectPath, JSON.stringify(projectConfig, null, 2) + '\n', { mode: 0o600 })

  // Update local SQLite project IDs
  const dbWrite = new Database(dbPath)
  dbWrite.prepare('UPDATE memories SET project_id = ? WHERE project_id = ?').run(projectId, config.projectId)
  dbWrite.close()

  console.log()
  console.log(chalk.bold('  Migration complete!'))
  console.log(chalk.dim(`  ${rows.length} memories now synced to cloud.`))
  console.log(chalk.dim('  Local SQLite cache retained for speed.'))
  console.log()
}

