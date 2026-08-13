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

/** A server-issued project id. `createCloudProject` returns the `projects.id` uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Result tiers for a single check.
 *
 * `warn` exists because the binary was actively harmful: doctor's job is to
 * tell a broken setup from a working one, and several states are neither.
 * A local-only project, a not-yet-created SQLite cache and a missing
 * post-commit hook all used to be forced into PASS or FAIL, and each one lied
 * — most damagingly the local-only PASS, which is the exact state a mis-run
 * `tages init` leaves a teammate in.
 *
 * The contract:
 *   pass — verified working. Nothing to do.
 *   warn — works, or is legitimately optional, but may not be what you meant.
 *          Never affects the exit code.
 *   fail — definitely broken. Sets exit code 1.
 */
type Status = 'pass' | 'warn' | 'fail'

const ICON: Record<Status, string> = {
  pass: chalk.green('PASS'),
  warn: chalk.yellow('WARN'),
  fail: chalk.red('FAIL'),
}

interface Tally {
  pass: number
  warn: number
  fail: number
}

/** Prints one check line and records it in the tally. Returns the status. */
function report(tally: Tally, status: Status, label: string, detail?: string): Status {
  console.log(`  ${ICON[status]}  ${label}${detail ? chalk.dim(` — ${detail}`) : ''}`)
  tally[status]++
  return status
}

function hint(line: string) {
  console.log(chalk.dim(`${HINT}${line}`))
}

/**
 * Prints the trailing summary and sets the process exit code.
 *
 * Warnings are reported but deliberately do not fail the command: a genuine
 * local-only user and a user who runs doctor outside a git repo are both
 * supported configurations, and making them exit non-zero would push people to
 * ignore doctor's exit code entirely. Only `fail` counts.
 *
 * `process.exitCode` rather than `process.exit()`: doctor is called in-process
 * by tests and must not tear down the runner.
 */
function printSummary(tally: Tally, suffix = '') {
  const parts = [
    `${tally.pass} passed`,
    `${tally.warn} ${tally.warn === 1 ? 'warning' : 'warnings'}`,
    `${tally.fail} failed`,
  ]
  console.log(`\n  ${chalk.bold(parts.join(', '))}${suffix}`)

  if (tally.fail > 0) {
    console.log(chalk.dim(`  ${tally.fail === 1 ? 'That failure' : 'Those failures'} must be fixed — tages will not work correctly until then.`))
    process.exitCode = 1
  } else if (tally.warn > 0) {
    console.log(chalk.dim('  No failures. Warnings are safe to ignore IF the setup above is what you intended.'))
  }
  console.log()
}

// ---------------------------------------------------------------------------
// Link detection
// ---------------------------------------------------------------------------

interface LinkedProject {
  /** True when this directory is bound to a project (marker or matching config). */
  linked: boolean
  slug?: string
  /**
   * SERVER-ISSUED project id from the local project config, when there is one.
   *
   * Deliberately empty for a local-only config. Its id is the synthetic
   * `local-<slug>` that `createLocalProject` invents, which `tages link` cannot
   * resolve — interpolating it would hand the user a copy-pasteable command
   * that is guaranteed to fail, in precisely the local-only case this advice
   * exists to rescue. Unset, callers print the `<project-id>` placeholder and
   * tell the user where to find the real one.
   */
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
      if (typeof cfg.projectId === 'string' && UUID_RE.test(cfg.projectId)) projectId = cfg.projectId
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
// Cloud-vs-local classification
// ---------------------------------------------------------------------------

/**
 * What kind of project config we are looking at.
 *
 * `deliberate-local` and `orphaned-cloud` both have empty Supabase credentials
 * — the difference is the shape of the `projectId`, which is the discriminator
 * described on {@link classifyProjectMode}.
 */
type ProjectMode =
  | { kind: 'cloud'; url: string; anonKey: string }
  | { kind: 'deliberate-local' }
  | { kind: 'orphaned-cloud'; projectId: string }
  | { kind: 'unclassified-local'; projectId?: string }

/**
 * Classifies a project config as cloud, deliberately local, or broken.
 *
 * The discriminator is the `projectId` SHAPE, and it is reliable because only
 * two code paths ever write one:
 *
 *   - `createLocalProject` (packages/shared/src/project-factory.ts) writes
 *     `local-<slug>` with empty credentials. This is the ONLY writer of a
 *     local-only config, reached from `tages init --local`.
 *   - `createCloudProject` / `findMemberProjectById` write the server's
 *     `projects.id` uuid, ALWAYS alongside a real url and anon key.
 *
 * So empty credentials + a uuid id is a state no tages version produces: the
 * config names a cloud project but carries nothing that can reach it. Memories
 * key off an id the client cannot sync, and no local-only mode was ever
 * intended. That is broken, not ambiguous, so it earns a `fail`.
 *
 * Note this classifies the config's SHAPE, not the user's intent. Shape alone
 * cannot tell a wanted local-only project from the one a failed `init` left
 * behind — both are written by the same function. Intent is narrowed further
 * in the check itself, using whether a cloud session exists on this machine.
 */
function classifyProjectMode(config: Record<string, unknown>): ProjectMode {
  const url = typeof config.supabaseUrl === 'string' ? config.supabaseUrl : ''
  const anonKey = typeof config.supabaseAnonKey === 'string' ? config.supabaseAnonKey : ''
  if (url && anonKey) return { kind: 'cloud', url, anonKey }

  const projectId = typeof config.projectId === 'string' && config.projectId ? config.projectId : undefined
  if (projectId && projectId.startsWith('local-')) return { kind: 'deliberate-local' }
  if (projectId && UUID_RE.test(projectId)) return { kind: 'orphaned-cloud', projectId }
  return { kind: 'unclassified-local', projectId }
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
// Cloud connection check
// ---------------------------------------------------------------------------

/**
 * Reports on cloud sync — the check this whole WARN tier exists for.
 *
 * It used to print `PASS — local-only mode (no cloud sync)` whenever the
 * Supabase credentials were empty. That is also exactly the state a mis-run
 * `tages init` leaves a teammate in: project slugs are globally unique, so a
 * joiner who runs `init` against a project someone else already owns cannot
 * create it, is told to fall back to `--local`, and ends up with a config that
 * shadows the real project. Their memories then go nowhere and no teammate ever
 * sees them — while doctor certified the setup green.
 *
 * A hard FAIL would be equally wrong: deliberate local-only is supported.
 *
 * The discriminator used here is whether a cloud SESSION exists on this machine
 * (`~/.config/tages/auth.json`):
 *
 *   - `tages init --local` writes no auth file — it never signs anyone in.
 *   - `tages init` (cloud) writes auth.json BEFORE it attempts to create the
 *     project, so the victim of the unique-slug failure always has one.
 *
 * So "local-only project + no session anywhere" is coherent and gets a PASS,
 * while "local-only project + a live cloud session" is the failure signature
 * and gets a WARN. It is a signal, not a proof — someone can legitimately hold
 * one cloud project and one local one — so the WARN names both readings and
 * says how to tell them apart rather than pretending to know.
 */
async function checkCloudConnection(
  tally: Tally,
  mode: ProjectMode,
  ctx: { slug: string; authExists: boolean; link: LinkedProject },
): Promise<void> {
  const LABEL = 'Supabase connection'

  if (mode.kind === 'cloud') {
    try {
      const supabase = await createAuthenticatedClient(mode.url, mode.anonKey)
      const { error } = await supabase.from('projects').select('id').limit(1)
      if (error) {
        report(tally, 'fail', LABEL, error.message)
        hint('Cloud sync is configured but unreachable — memories will not reach your teammates.')
      } else {
        report(tally, 'pass', LABEL, mode.url)
      }
    } catch (e) {
      report(tally, 'fail', LABEL, (e as Error).message)
      hint('Cloud sync is configured but unreachable — memories will not reach your teammates.')
    }
    return
  }

  if (mode.kind === 'orphaned-cloud') {
    // Empty credentials next to a server-issued uuid is a state no tages
    // version writes: `createLocalProject` always invents a `local-` id, and
    // every cloud writer stores the url and key alongside the uuid. The config
    // names a cloud project it has no way to reach, and it is not local-only
    // either, so it cannot work in either mode.
    report(tally, 'fail', LABEL, 'cloud project with no credentials')
    hint(`This config names cloud project ${mode.projectId} but stores no Supabase url or key,`)
    hint('so nothing can sync and it is not a valid local-only config either.')
    hint(`Repair it:  tages link --project-id ${mode.projectId}`)
    return
  }

  if (mode.kind === 'unclassified-local') {
    report(tally, 'warn', LABEL, 'no cloud credentials, and the project id is unrecognized')
    hint('No Supabase url or key, and the project id is neither a `local-` id nor a')
    hint('server uuid — so doctor cannot tell whether local-only was intended.')
    hint('If you meant to join a teammate\'s project:  tages link --project-id <project-id>')
    return
  }

  // deliberate-local
  if (!ctx.authExists) {
    report(tally, 'pass', LABEL, 'local-only mode (no cloud sync)')
    hint('No cloud session on this machine either, so this is a deliberate local-only setup.')
    hint(`Memories for '${ctx.slug}' stay on this machine and are not shared with teammates.`)
    return
  }

  report(tally, 'warn', LABEL, 'local-only mode, but this machine has a cloud session')
  hint(`Memories for '${ctx.slug}' are stored locally only — they are NOT synced, and no`)
  hint('teammate will ever see them. Two different situations look identical here:')
  hint('  1. You chose local-only (`tages init --local`). Nothing is wrong — ignore this.')
  hint('  2. You meant to join a teammate\'s project. `tages init` could not reuse their')
  hint('     slug (slugs are globally unique), so you fell back to local-only and this')
  hint('     config now shadows the real project.')
  hint(`Tell them apart: if a teammate already owns a project named '${ctx.slug}', it is case 2.`)
  if (ctx.link.projectId) {
    hint(`To join it:  tages link --project-id ${ctx.link.projectId}`)
  } else {
    hint('To join it:  tages link --project-id <project-id>')
    hint('(find the id on the project\'s dashboard page, or ask a project owner/admin)')
  }
}

// ---------------------------------------------------------------------------

export async function doctorCommand(options: DoctorOptions) {
  console.log(chalk.bold('\n  Tages Doctor\n'))

  const tally: Tally = { pass: 0, warn: 0, fail: 0 }

  const projectsDir = getProjectsDir()
  const link = detectLinkedProject(projectsDir)

  // Resolve and read the project config BEFORE the first check prints.
  //
  // Nothing here writes output, so the printed order is unchanged — but the
  // auth check's severity depends on whether this project needs a cloud
  // session at all, and the auth check prints first. Any parse error is held
  // and reported at check 2, where it belongs.
  const projectFiles = fs.existsSync(projectsDir)
    ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'))
    : []
  const resolved = resolveProject(projectsDir, options.project, link, projectFiles)
  const hasProject = !!resolved && fs.existsSync(resolved.path)

  let config: Record<string, unknown> | null = null
  let configError: string | null = null
  if (hasProject && resolved) {
    try {
      config = JSON.parse(fs.readFileSync(resolved.path, 'utf-8'))
    } catch (e) {
      configError = (e as Error).message
    }
  }
  const mode: ProjectMode | null = config ? classifyProjectMode(config) : null

  // 1. Auth config exists
  const authPath = getAuthPath()
  const authExists = fs.existsSync(authPath)
  if (authExists) {
    report(tally, 'pass', 'Auth config', authPath)
  } else if (mode?.kind === 'deliberate-local') {
    // A local-only project stores nothing in the cloud, so it needs no session.
    // Failing here would mark the single most common supported offline setup as
    // broken, which is the same category of lie this command is fixing.
    report(tally, 'warn', 'Auth config', 'no stored session — not required for a local-only project')
    // Deliberately NOT printSetupAdvice(): this is a coherent, supported setup,
    // and leading with "do NOT run `tages init`" reads as an alarm on a machine
    // where nothing is wrong. One conditional line is enough.
    hint('Local-only projects need no sign-in, so this is not a problem by itself.')
    hint('Cloud sync and teammate sharing stay unavailable until you sign in.')
    hint('To join a teammate\'s cloud project:  tages link --project-id <project-id>')
  } else {
    report(tally, 'fail', 'Auth config', 'no stored session')
    // Deliberately does not name a command itself: whichever setup command is
    // right for this directory also performs the GitHub sign-in, so naming one
    // here would contradict the advice printed just below.
    hint('No stored session. The setup command for this directory also signs you in:')
    printSetupAdvice(link)
  }

  // 2. Project config for THIS directory
  if (hasProject && resolved) {
    report(tally, 'pass', 'Project config', `${resolved.slug} (${resolved.source})`)
  } else {
    report(tally, 'fail', 'Project config', 'none')
    if (resolved) hint(`Expected a project config at ${resolved.path}`)
    printSetupAdvice(link)
  }

  if (!hasProject || !resolved) {
    printSummary(tally, chalk.dim(' (remaining checks skipped — no project)'))
    return
  }

  if (!config) {
    report(tally, 'fail', 'Project config readable', configError || 'unreadable')
    hint(`${resolved.path} is not valid JSON — fix or remove it, then re-run.`)
    printSummary(tally, chalk.dim(' (remaining checks skipped — config unreadable)'))
    return
  }

  const slug = (typeof config.slug === 'string' && config.slug) || resolved.slug

  // 3. SQLite cache exists
  //
  // WARN, not FAIL: the cache is a performance layer the MCP server creates on
  // first start. Its own remediation line already said "this will happen by
  // itself", which is not something a FAIL should ever say.
  const cachePath = getCachePath(slug)
  if (fs.existsSync(cachePath)) {
    report(tally, 'pass', 'SQLite cache', cachePath)
  } else {
    report(tally, 'warn', 'SQLite cache', 'not created yet')
    hint('Normal before the first MCP server start — it is created on demand.')
  }

  // 4. Cloud connectivity, or an honest account of why there is none
  await checkCloudConnection(tally, mode ?? classifyProjectMode(config), { slug, authExists, link })

  // 5. Git hook installed
  //
  // WARN, not FAIL, in both branches: the post-commit hook drives auto-indexing,
  // which is an optional convenience. Memories, recall and sync all work without
  // it, and running doctor outside a repo is not a defect at all.
  const hookPath = resolvePostCommitHookPath()
  const hookInstalled = !!hookPath
    && fs.existsSync(hookPath)
    && fs.readFileSync(hookPath, 'utf-8').includes('tages')
  if (hookInstalled) {
    report(tally, 'pass', 'Git hook (auto-indexing)', hookPath as string)
  } else if (hookPath) {
    report(tally, 'warn', 'Git hook (auto-indexing)', 'not installed')
    hint('Auto-indexing on commit is off. Everything else works without it.')
    hint('Run `tages index --install` to install the post-commit hook.')
  } else {
    report(tally, 'warn', 'Git hook (auto-indexing)', 'not a git repository')
    hint('Auto-indexing needs a git repository — run doctor inside your repo.')
  }

  // 6. MCP server entry, project scope first
  //
  // Stays a FAIL: with no server entry the coding agent cannot reach tages at
  // all. Nothing ambiguous about it.
  const mcpLocation = findMcpServerEntry()
  const mcpDetail = mcpLocation
    ? `${mcpLocation.label} — ${mcpLocation.path}`
    : 'not found in any known location'
  if (mcpLocation) {
    report(tally, 'pass', 'MCP server config', mcpDetail)
  } else {
    report(tally, 'fail', 'MCP server config', mcpDetail)
    hint(`No tages entry in ${getClaudeCodeMcpConfigPath()} or your Claude Desktop config.`)
    printSetupAdvice(link)
    hint(`Or add the server by hand to ${getClaudeCodeMcpConfigPath()}:`)
    hint('  { "mcpServers": { "tages": { "command": "npx", "args": ["-y", "@tages/server"] } } }')
  }

  printSummary(tally)
}
