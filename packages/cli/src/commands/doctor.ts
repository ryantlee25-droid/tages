import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import {
  getProjectsDir,
  getCachePath,
  getAuthPath,
  getClaudeCodeMcpConfigPath,
  getClaudeDesktopConfigPath,
} from '../config/paths.js'

interface DoctorOptions {
  project?: string
}

/** Indent used for the remediation lines printed under a failed check. */
const HINT = '         '

function check(label: string, ok: boolean, detail?: string): boolean {
  const icon = ok ? chalk.green('PASS') : chalk.red('FAIL')
  console.log(`  ${icon}  ${label}${detail ? chalk.dim(` — ${detail}`) : ''}`)
  return ok
}

function hint(line: string) {
  console.log(chalk.dim(`${HINT}${line}`))
}

// ---------------------------------------------------------------------------
// Link detection
// ---------------------------------------------------------------------------

interface LinkedProject {
  /** True when this directory is bound to a project (marker or matching config). */
  linked: boolean
  slug?: string
  /** Project id from the local project config, when one is readable. */
  projectId?: string
  source: 'marker' | 'directory-name' | null
  /** Path to ~/.config/tages/projects/<slug>.json for the detected slug. */
  configPath?: string
}

/**
 * Decides whether the CURRENT directory is already bound to a tages project.
 *
 * This mirrors the first two steps of `loadProjectConfig`'s resolution
 * (`.tages/config.json` marker, then sanitized cwd basename) but deliberately
 * OMITS its third step, the "first project file alphabetically" fallback.
 * That fallback resolves for practically every user with any project at all,
 * so including it here would report an unlinked directory as linked — and the
 * whole point of this signal is to decide whether `tages init` is safe advice.
 */
function detectLinkedProject(projectsDir: string): LinkedProject {
  let slug: string | undefined
  let source: LinkedProject['source'] = null

  const markerPath = path.join(process.cwd(), '.tages', 'config.json')
  if (fs.existsSync(markerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      if (typeof marker.slug === 'string' && marker.slug) {
        slug = marker.slug
        source = 'marker'
      }
    } catch {
      // Corrupt marker — fall through to directory-name detection.
    }
  }

  if (!slug) {
    const basename = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    if (basename && fs.existsSync(path.join(projectsDir, `${basename}.json`))) {
      slug = basename
      source = 'directory-name'
    }
  }

  if (!slug) return { linked: false, source: null }

  const configPath = path.join(projectsDir, `${slug}.json`)
  let projectId: string | undefined
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (typeof cfg.projectId === 'string' && cfg.projectId) projectId = cfg.projectId
    } catch {
      // Corrupt project config — other checks report it; no id to offer.
    }
  }

  return { linked: true, slug, projectId, source, configPath }
}

/**
 * Prints the "how do I fix this" lines for any check whose remedy is
 * re-running configuration.
 *
 * `tages init` is NOT a safe default here. Project slugs are globally unique,
 * so running `init` against a project a teammate already created either fails
 * with a misleading billing error or silently drops the user into local-only
 * mode — and the local-only config it writes then blocks `tages link` from
 * repairing it. So we only ever name `init` when this directory is definitely
 * not already linked, and even then we name the join path alongside it.
 */
function printSetupAdvice(link: LinkedProject) {
  if (link.linked) {
    hint(`This directory is already linked to project '${link.slug}' — do NOT run \`tages init\`.`)
    if (link.projectId) {
      hint(`Re-run:  tages link --project-id ${link.projectId}`)
    } else {
      hint('Re-run:  tages link --project-id <project-id>')
      hint('(find the id on the project\'s dashboard page, or ask a project owner/admin)')
    }
    return
  }

  hint('Joining a project a teammate already created?  tages link --project-id <project-id>')
  hint('Creating a genuinely new project?              tages init')
  hint('Slugs are globally unique, so `tages init` against an existing project fails or')
  hint('silently drops you into local-only mode. If in doubt, use `tages link`.')
}

// ---------------------------------------------------------------------------
// MCP config probing
// ---------------------------------------------------------------------------

interface McpLocation {
  path: string
  label: string
}

/**
 * Every place a tages MCP server entry may legitimately live, most-likely first.
 *
 * The project-scoped `.mcp.json` comes FIRST because it is what `tages init`
 * and `tages link` actually write, and what Claude Code actually reads. This
 * check used to probe only the two Claude *Desktop* paths, so a correctly
 * configured Claude Code user was told their setup was broken.
 *
 * The Desktop paths are kept as fallbacks so a genuine Claude Desktop user
 * still passes.
 */
function mcpProbeLocations(): McpLocation[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || ''

  const candidates: McpLocation[] = [
    { path: getClaudeCodeMcpConfigPath(), label: 'Claude Code project scope' },
    { path: getClaudeDesktopConfigPath(), label: 'Claude Desktop' },
  ]

  // Explicit per-platform Desktop paths, so a config written on the other
  // platform's convention (or by an older tages) is still found.
  if (homeDir) {
    candidates.push(
      {
        path: path.join(homeDir, 'Library/Application Support/Claude/claude_desktop_config.json'),
        label: 'Claude Desktop (macOS)',
      },
      {
        path: path.join(homeDir, '.config/claude/claude_desktop_config.json'),
        label: 'Claude Desktop (Linux)',
      },
    )
  }

  const seen = new Set<string>()
  const unique: McpLocation[] = []
  for (const candidate of candidates) {
    if (!candidate.path || seen.has(candidate.path)) continue
    seen.add(candidate.path)
    unique.push(candidate)
  }
  return unique
}

/** Returns the first location carrying a tages MCP server entry, or null. */
function findMcpServerEntry(): McpLocation | null {
  for (const location of mcpProbeLocations()) {
    if (!fs.existsSync(location.path)) continue
    try {
      const content = JSON.parse(fs.readFileSync(location.path, 'utf-8'))
      if (content?.mcpServers?.tages || content?.mcpServers?.['tages-server']) {
        return location
      }
    } catch {
      // Unparseable config — treat as "not configured here" and keep probing.
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Git hook probing
// ---------------------------------------------------------------------------

/**
 * Resolves this repo's post-commit hook path the way git itself would.
 *
 * The previous `path.resolve('.git/hooks/post-commit')` only ever looked at a
 * literal `.git` DIRECTORY in the cwd, so it reported "not installed" both from
 * any subdirectory of a repo and inside a linked worktree (where `.git` is a
 * file). `installPostCommitHook` handles both, so doctor disagreed with the
 * installer. `git rev-parse --git-path` covers both cases in one call, matching
 * how `config/mcp-inject.ts` resolves `info/exclude`.
 *
 * Returns null when this is not a git repository (or git is unavailable).
 */
function resolvePostCommitHookPath(): string | null {
  try {
    const raw = execFileSync('git', ['rev-parse', '--git-path', 'hooks/post-commit'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!raw) return null
    return path.resolve(process.cwd(), raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Project config resolution
// ---------------------------------------------------------------------------

interface ResolvedProject {
  path: string
  slug: string
  source: string
}

/**
 * Picks WHICH project config doctor should report on.
 *
 * This used to be `projectFiles[0]` — the alphabetically first config in
 * ~/.config/tages/projects — regardless of what directory doctor was run in.
 * With more than one project configured that silently diagnosed the wrong
 * project's cache and cloud connection. Now it honors --project, then this
 * directory's link, and only then falls back to the legacy first-file pick
 * (labelled as such, so the output says which project it actually inspected).
 */
function resolveProject(
  projectsDir: string,
  explicitSlug: string | undefined,
  link: LinkedProject,
  projectFiles: string[],
): ResolvedProject | null {
  if (explicitSlug) {
    return {
      path: path.join(projectsDir, `${explicitSlug}.json`),
      slug: explicitSlug,
      source: 'via --project',
    }
  }

  if (link.linked && link.slug && link.configPath) {
    return {
      path: link.configPath,
      slug: link.slug,
      source: link.source === 'marker' ? 'via .tages/config.json' : 'via directory name',
    }
  }

  if (projectFiles.length > 0) {
    return {
      path: path.join(projectsDir, projectFiles[0]),
      slug: projectFiles[0].replace(/\.json$/, ''),
      source: 'first available — this directory is not linked',
    }
  }

  return null
}

// ---------------------------------------------------------------------------

export async function doctorCommand(options: DoctorOptions) {
  console.log(chalk.bold('\n  Tages Doctor\n'))

  let passed = 0
  let failed = 0

  const projectsDir = getProjectsDir()
  const link = detectLinkedProject(projectsDir)

  // 1. Auth config exists
  const authPath = getAuthPath()
  if (check('Auth config', fs.existsSync(authPath), authPath)) passed++
  else {
    failed++
    // Deliberately does not name a command itself: whichever setup command is
    // right for this directory also performs the GitHub sign-in, so naming one
    // here would contradict the advice printed just below.
    hint('No stored session. The setup command for this directory also signs you in:')
    printSetupAdvice(link)
  }

  // 2. Project config for THIS directory
  const projectFiles = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'))
    : []
  const resolved = resolveProject(projectsDir, options.project, link, projectFiles)
  const hasProject = !!resolved && fs.existsSync(resolved.path)

  if (check('Project config', hasProject, hasProject && resolved ? `${resolved.slug} (${resolved.source})` : 'none')) {
    passed++
  } else {
    failed++
    if (resolved) hint(`Expected a project config at ${resolved.path}`)
    printSetupAdvice(link)
  }

  if (!hasProject || !resolved) {
    console.log(`\n  ${chalk.bold(`${passed} passed, ${failed} failed`)} (remaining checks skipped — no project)\n`)
    return
  }

  // Load project config
  let config: Record<string, unknown>
  try {
    config = JSON.parse(fs.readFileSync(resolved.path, 'utf-8'))
  } catch (e) {
    check('Project config readable', false, (e as Error).message)
    failed++
    hint(`${resolved.path} is not valid JSON — fix or remove it, then re-run.`)
    console.log(`\n  ${chalk.bold(`${passed} passed, ${failed} failed`)} (remaining checks skipped — config unreadable)\n`)
    return
  }

  const slug = (typeof config.slug === 'string' && config.slug) || resolved.slug

  // 3. SQLite cache exists
  const cachePath = getCachePath(slug)
  if (check('SQLite cache', fs.existsSync(cachePath), cachePath)) passed++
  else { failed++; hint('Cache will be created on first MCP server start.') }

  // 4. Supabase connectivity (if cloud mode)
  if (config.supabaseUrl && config.supabaseAnonKey) {
    try {
      const supabase = await createAuthenticatedClient(
        config.supabaseUrl as string,
        config.supabaseAnonKey as string,
      )
      const { error } = await supabase.from('projects').select('id').limit(1)
      if (check('Supabase connection', !error, error ? error.message : (config.supabaseUrl as string))) passed++
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
  const hookPath = resolvePostCommitHookPath()
  const hookInstalled = !!hookPath
    && fs.existsSync(hookPath)
    && fs.readFileSync(hookPath, 'utf-8').includes('tages')
  const hookDetail = hookInstalled
    ? (hookPath as string)
    : hookPath
      ? 'not installed'
      : 'not a git repository'
  if (check('Git hook (auto-indexing)', hookInstalled, hookDetail)) passed++
  else {
    failed++
    if (hookPath) hint('Run `tages index --install` to install the post-commit hook.')
    else hint('Auto-indexing needs a git repository — run doctor inside your repo.')
  }

  // 6. MCP server entry, project scope first
  const mcpLocation = findMcpServerEntry()
  const mcpDetail = mcpLocation
    ? `${mcpLocation.label} — ${mcpLocation.path}`
    : 'not found in any known location'
  if (check('MCP server config', !!mcpLocation, mcpDetail)) passed++
  else {
    failed++
    hint(`No tages entry in ${getClaudeCodeMcpConfigPath()} or your Claude Desktop config.`)
    printSetupAdvice(link)
    hint(`Or add the server by hand to ${getClaudeCodeMcpConfigPath()}:`)
    hint('  { "mcpServers": { "tages": { "command": "npx", "args": ["-y", "@tages/server"] } } }')
  }

  console.log(`\n  ${chalk.bold(`${passed} passed, ${failed} failed`)}\n`)
}
