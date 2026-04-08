import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { getProjectsDir, getCachePath, getAuthPath } from '../config/paths.js'

interface DoctorOptions {
  project?: string
}

function check(label: string, ok: boolean, detail?: string): boolean {
  const icon = ok ? chalk.green('PASS') : chalk.red('FAIL')
  console.log(`  ${icon}  ${label}${detail ? chalk.dim(` — ${detail}`) : ''}`)
  return ok
}

export async function doctorCommand(options: DoctorOptions) {
  console.log(chalk.bold('\n  Tages Doctor\n'))

  let passed = 0
  let failed = 0

  // 1. Auth config exists
  const authPath = getAuthPath()
  if (check('Auth config', fs.existsSync(authPath), authPath)) passed++
  else { failed++; console.log(chalk.dim('         Run `tages init` to set up authentication.')) }

  // 2. Project config exists
  const dir = getProjectsDir()
  const projectFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []
  const hasProject = projectFiles.length > 0
  if (check('Project config', hasProject, hasProject ? `${projectFiles.length} project(s)` : 'none')) passed++
  else { failed++; console.log(chalk.dim('         Run `tages init` to create a project.')) }

  if (!hasProject) {
    console.log(`\n  ${chalk.bold(`${passed} passed, ${failed} failed`)} (remaining checks skipped — no project)\n`)
    return
  }

  // Load project config
  const slug = options.project || undefined
  const configPath = slug
    ? `${dir}/${slug}.json`
    : `${dir}/${projectFiles[0]}`
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  // 3. SQLite cache exists
  const cachePath = getCachePath(config.slug)
  if (check('SQLite cache', fs.existsSync(cachePath), cachePath)) passed++
  else { failed++; console.log(chalk.dim('         Cache will be created on first MCP server start.')) }

  // 4. Supabase connectivity (if cloud mode)
  if (config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
      const { error } = await supabase.from('projects').select('id').limit(1)
      if (check('Supabase connection', !error, error ? error.message : config.supabaseUrl)) passed++
      else failed++
    } catch (e) {
      check('Supabase connection', false, (e as Error).message)
      failed++
    }
  } else {
    check('Supabase connection', true, 'local-only mode (no cloud sync)')
    passed++
  }

  // 5. Git hook installed
  const gitDir = path.resolve('.git/hooks/post-commit')
  const hookInstalled = fs.existsSync(gitDir) && fs.readFileSync(gitDir, 'utf-8').includes('tages')
  if (check('Git hook (auto-indexing)', hookInstalled, hookInstalled ? gitDir : 'not installed')) passed++
  else { failed++; console.log(chalk.dim('         Run `tages index --install` or re-run `tages init` in a git repo.')) }

  // 6. MCP server entry in Claude Code config
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const mcpPaths = [
    path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json'),
    path.join(homeDir, '.config/claude/claude_desktop_config.json'),
  ]
  const mcpConfigured = mcpPaths.some(p => {
    if (!fs.existsSync(p)) return false
    try {
      const content = JSON.parse(fs.readFileSync(p, 'utf-8'))
      return content.mcpServers?.tages || content.mcpServers?.['tages-server']
    } catch { return false }
  })
  if (check('MCP server config', mcpConfigured, mcpConfigured ? 'found in Claude Code config' : 'not found')) passed++
  else { failed++; console.log(chalk.dim('         Run `tages init` to auto-configure the MCP server.')) }

  console.log(`\n  ${chalk.bold(`${passed} passed, ${failed} failed`)}\n`)
}
