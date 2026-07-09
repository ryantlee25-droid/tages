/**
 * `tages harness` — instrumented harness enable/disable/status/sync.
 *
 * The instrumented harness is a per-developer opt-in capture path for
 * Claude Code hooks (PreToolUse/PostToolUse/SessionEnd/Stop). See
 * PRIVACY.md's "The Instrumented Harness" section for the full disclosure
 * this command's `enable` confirmation prompt quotes.
 *
 * - `enable`:  requires an existing cloud project config, prints exactly
 *   what will be captured/redacted/retained, requires explicit
 *   confirmation, then MERGES (never overwrites) a Tages-owned hooks
 *   block into the developer's own gitignored `.claude/settings.local.json`
 *   — never the shared/committed `.claude/settings.json`. Any pre-existing
 *   unrelated hooks entries or other top-level keys in that file are
 *   preserved untouched.
 * - `disable`: removes only the Tages-owned hooks block.
 * - `status`:  reports enabled/disabled, last sync time, and pending
 *   (unsynced) local row count.
 * - `sync`:    reads unsynced rows from the local HarnessLog (cross-package
 *   import of `@tages/harness-claude-code`'s dist, following
 *   `sync/cli-sync.ts`'s createRequire + dist-walk pattern — see memory
 *   `feedback_esm_cjs_crosspackage`) and batch-inserts them into
 *   `harness_tool_events` in ONE Supabase call via `createAuthenticatedClient`,
 *   then marks the rows synced locally.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import chalk from 'chalk'
import ora from 'ora'
import { loadProjectConfig } from '../config/project.js'
import { createAuthenticatedClient } from '../auth/session.js'

export interface HarnessCommandOptions {
  project?: string
  yes?: boolean
}

/** Legacy/default hook command string (the bare bin name). Kept as the
 * default so `mergeHarnessHooks({})` stays deterministic for pure-logic tests,
 * but real `enable` now writes an ABSOLUTE `node <path>` invocation resolved at
 * enable-time (see resolveHarnessBinCommand) — a bare bin name never resolves
 * for an installed CLI because @tages/cli doesn't depend on the harness
 * package, so capture silently never ran. */
const TAGES_HOOK_COMMAND = 'tages-harness-claude-code'

/** Substring that identifies ANY Tages-owned hook command — the legacy bare
 * `tages-harness-claude-code` and the absolute `node .../harness-claude-code/
 * dist/index.js` form both contain it. Used to find (and only remove) Tages'
 * own entries so unrelated hooks from other tools/plugins are never touched. */
const TAGES_HOOK_MARKER = 'harness-claude-code'

const HARNESS_HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop'] as const
type HarnessHookEvent = (typeof HARNESS_HOOK_EVENTS)[number]

interface HookEntry {
  type: string
  command: string
  [key: string]: unknown
}

interface HookMatcherGroup {
  matcher?: string
  hooks: HookEntry[]
  [key: string]: unknown
}

/** Shape of `.claude/settings.local.json`. Only the `hooks` key is ever
 * inspected/modified here — every other top-level key (permissions, etc.)
 * is passed through untouched by object-spreading the original settings. */
interface ClaudeSettings {
  hooks?: Partial<Record<string, HookMatcherGroup[]>>
  [key: string]: unknown
}

function getSettingsPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.claude', 'settings.local.json')
}

/** Reads `.claude/settings.local.json`. Missing file -> `{}`. Corrupt JSON
 * -> `{}` with a warning (soft-fail rather than crash — this file is
 * outside Tages' normal blast radius and we never want a read to throw
 * mid-command). */
function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {}
  const raw = fs.readFileSync(settingsPath, 'utf-8')
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    console.error(
      chalk.yellow(
        `Warning: ${settingsPath} contains invalid JSON — treating as empty. Fix or remove the file if this is unexpected.`,
      ),
    )
    return {}
  }
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}

function isTagesOwnedGroup(group: HookMatcherGroup): boolean {
  return (
    Array.isArray(group.hooks) &&
    group.hooks.some((h) => typeof h.command === 'string' && h.command.includes(TAGES_HOOK_MARKER))
  )
}

/**
 * Resolves the ABSOLUTE `node <path>` command that a Tages hook must invoke.
 * A bare `tages-harness-claude-code` on PATH won't resolve for an installed
 * CLI (the CLI doesn't depend on the harness package), so capture silently
 * never fires. We resolve the compiled harness entry to an absolute path and
 * invoke it via node.
 *
 * Resolution order:
 *   1. `require.resolve('@tages/harness-claude-code')` (works if it ever
 *      becomes a real dependency / is hoisted into node_modules).
 *   2. Walk up from this file to `packages/harness-claude-code/dist/index.js`
 *      (the monorepo/source-checkout layout — mirrors loadHarnessLogModule()).
 *
 * Returns null when it can't be resolved, so `enable` can fail loudly instead
 * of writing a broken hook.
 */
export function resolveHarnessBinPath(): string | null {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@tages/harness-claude-code')
  } catch {
    // Not resolvable as a dependency — fall through to the dist-walk.
  }
  try {
    const __filename = fileURLToPath(import.meta.url)
    let dir = path.dirname(__filename)
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, 'packages', 'harness-claude-code', 'dist', 'index.js')
      if (fs.existsSync(candidate)) return candidate
      dir = path.dirname(dir)
    }
  } catch {
    // fall through
  }
  return null
}

/** Builds the shell command string a hook entry runs, from an absolute bin
 * path. Quoted so paths with spaces still execute. */
function harnessHookCommand(binPath: string): string {
  return `node ${JSON.stringify(binPath)}`
}

/**
 * Merges (never overwrites) the Tages hooks block into `settings`. Any
 * pre-existing hook matcher groups for other commands, and any other
 * top-level keys (permissions, etc.), are carried through unchanged.
 * Idempotent: re-running replaces only the prior Tages-owned group per
 * event, never duplicates it.
 */
export function mergeHarnessHooks(
  settings: ClaudeSettings,
  command: string = TAGES_HOOK_COMMAND,
): ClaudeSettings {
  const mergedHooks: Partial<Record<string, HookMatcherGroup[]>> = { ...(settings.hooks ?? {}) }
  for (const event of HARNESS_HOOK_EVENTS) {
    const existing = mergedHooks[event] ?? []
    const withoutTages = existing.filter((g) => !isTagesOwnedGroup(g))
    mergedHooks[event] = [
      ...withoutTages,
      { matcher: '*', hooks: [{ type: 'command', command }] },
    ]
  }
  return { ...settings, hooks: mergedHooks }
}

/** Removes only the Tages-owned hooks block, leaving every other hook
 * matcher group and every other top-level key untouched. */
export function removeHarnessHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks) return settings

  const hooks: Partial<Record<string, HookMatcherGroup[]>> = { ...settings.hooks }
  for (const event of HARNESS_HOOK_EVENTS) {
    const groups = hooks[event]
    if (!groups) continue
    const withoutTages = groups.filter((g) => !isTagesOwnedGroup(g))
    if (withoutTages.length > 0) {
      hooks[event] = withoutTages
    } else {
      delete hooks[event]
    }
  }

  const result: ClaudeSettings = { ...settings }
  if (Object.keys(hooks).length > 0) {
    result.hooks = hooks
  } else {
    delete result.hooks
  }
  return result
}

/**
 * True when ANY harness hook event has a Tages-owned group present.
 *
 * Deliberately "any", not "all": a partial state (e.g. one of the four groups
 * was manually removed, or a prior disable/enable was interrupted) still means
 * capture hooks are firing. Treating that as "enabled" lets `disable` fully
 * clean it up instead of no-op'ing and leaving orphaned capture hooks live.
 */
export function isHarnessEnabled(settings: ClaudeSettings): boolean {
  if (!settings.hooks) return false
  return HARNESS_HOOK_EVENTS.some((event: HarnessHookEvent) => {
    const groups = settings.hooks![event]
    return Array.isArray(groups) && groups.some(isTagesOwnedGroup)
  })
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

// ---------------------------------------------------------------------------
// Cross-package import of @tages/harness-claude-code's local SQLite log.
// The CLI is ESM, harness-claude-code compiles to CommonJS (see its
// tsconfig's Node16 module setting) — mirrors sync/cli-sync.ts's
// createRequire + dist-walk pattern exactly (memory: feedback_esm_cjs_crosspackage).
// ---------------------------------------------------------------------------

interface HarnessEventRow {
  id: number
  source: string
  sessionId: string
  eventType: string
  agentName: string | null
  toolName: string | null
  exitCode: number | null
  filePath: string | null
  durationMs: number | null
  argsScrubbed: Record<string, unknown> | null
  resultSummary: string | null
  secretsRedactedCount: number
  createdAt: string
  syncedAt: string | null
}

interface HarnessLogInstance {
  pendingCount(): number
  getUnsynced(limit?: number): HarnessEventRow[]
  markSynced(ids: number[]): void
  lastSyncedAt(): string | null
  close(): void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let HarnessLogCtor: new (dbPath: string) => HarnessLogInstance
let getHarnessDbPathFn: (cwd?: string) => string
/* eslint-enable @typescript-eslint/no-explicit-any */

async function loadHarnessLogModule(): Promise<void> {
  if (HarnessLogCtor) return
  try {
    // Resolve harness-claude-code's own dist: walk up from this file until
    // we find packages/harness-claude-code/dist (a separately-built package).
    const __filename = fileURLToPath(import.meta.url)
    let dir = path.dirname(__filename)
    let harnessDist = ''
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, 'packages', 'harness-claude-code', 'dist')
      if (fs.existsSync(path.join(candidate, 'local-log.js'))) {
        harnessDist = candidate
        break
      }
      dir = path.dirname(dir)
    }

    if (harnessDist) {
      // Load CJS harness-claude-code dist from ESM CLI
      const require = createRequire(import.meta.url)
      const mod = require(path.join(harnessDist, 'local-log.js'))
      HarnessLogCtor = mod.HarnessLog
      getHarnessDbPathFn = mod.getHarnessDbPath
    } else {
      // tsx/vitest source execution: dynamic import from source
      // @ts-ignore — cross-package import
      const mod = await import('../../../harness-claude-code/src/local-log.js')
      HarnessLogCtor = mod.HarnessLog
      getHarnessDbPathFn = mod.getHarnessDbPath
    }
  } catch (e) {
    throw new Error(`Failed to load @tages/harness-claude-code's local log: ${(e as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function harnessEnableCommand(
  options: HarnessCommandOptions,
  deps: { resolveBin?: () => string | null } = {},
): Promise<void> {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(
      chalk.red(
        'No cloud project configured. Run `tages init` first — the instrumented harness syncs captured events to your project.',
      ),
    )
    process.exit(1)
    return
  }

  // PREFLIGHT: resolve the capture bin's absolute path BEFORE writing anything.
  // A bare bin name on PATH won't resolve for an installed CLI, so writing it
  // would silently disable capture. Fail loudly instead of writing a broken
  // hook.
  const resolveBin = deps.resolveBin ?? resolveHarnessBinPath
  const binPath = resolveBin()
  if (!binPath) {
    console.error(
      chalk.red(
        'Could not locate the Tages harness capture binary (@tages/harness-claude-code).',
      ),
    )
    console.error(
      chalk.dim(
        'The harness package must be installed/built alongside the CLI. No hooks were written — capture would not have run.',
      ),
    )
    process.exit(1)
    return
  }
  const hookCommand = harnessHookCommand(binPath)

  console.log()
  console.log(chalk.bold('Instrumented Harness — per-developer opt-in'))
  console.log(
    chalk.dim(
      'You are opting YOURSELF in. This is off by default and never turned on for your team automatically.',
    ),
  )
  console.log()
  console.log(
    `  ${chalk.bold("What's captured:")} the tool name your AI coding agent invokes (Read, Edit, Bash, etc.), ` +
      'redacted arguments and file paths, exit codes where available, durations where they can be derived, ' +
      'timestamps, your session id, and your agent id.',
  )
  console.log(
    `  ${chalk.bold("What's redacted:")} secrets and PII are stripped out of the captured data before anything ` +
      'is written to disk or synced anywhere. Raw, unredacted tool-call payloads never leave your machine — ' +
      'the redaction happens locally, first.',
  )
  console.log(
    `  ${chalk.bold('Local vs. synced:')} capture always writes to a local SQLite log on your machine first. ` +
      'Nothing is uploaded automatically. A batch `tages harness sync` uploads the already-redacted records.',
  )
  console.log(
    `  ${chalk.bold('Where the config lives:')} enabling writes hook configuration to your own ` +
      `${chalk.cyan('.claude/settings.local.json')} — gitignored by convention and personal to you, never ` +
      'pushed to your team.',
  )
  console.log(
    `  ${chalk.bold('Retention:')} synced records are retained for ${chalk.bold('90 days')} on our servers, ` +
      'then deleted. Your local cache is retained until you clear it yourself.',
  )
  console.log()
  console.log(chalk.dim('You can disable this at any time by running `tages harness disable`.'))
  console.log()

  if (!options.yes) {
    const confirmed = await promptYesNo('  Enable the instrumented harness for yourself? [y/N] ')
    if (!confirmed) {
      console.log(chalk.dim('  Cancelled.'))
      return
    }
  }

  const settingsPath = getSettingsPath()
  const existing = readSettings(settingsPath)
  const merged = mergeHarnessHooks(existing, hookCommand)
  writeSettings(settingsPath, merged)

  console.log(chalk.green(`Instrumented harness enabled. Hooks written to ${settingsPath}.`))
  console.log(chalk.dim('Run `tages harness status` to check pending events, `tages harness sync` to upload them.'))
}

export async function harnessDisableCommand(_options: HarnessCommandOptions): Promise<void> {
  const settingsPath = getSettingsPath()
  const existing = readSettings(settingsPath)

  // "enabled" is now ANY Tages-owned group being present (see isHarnessEnabled),
  // so a partial/interrupted state still qualifies. Whenever anything Tages-owned
  // is present, ALWAYS run removeHarnessHooks to strip ALL Tages groups —
  // never leave orphaned capture hooks firing because the state looked
  // incomplete.
  if (!isHarnessEnabled(existing)) {
    console.log(chalk.dim('Instrumented harness is not enabled — nothing to do.'))
    return
  }

  const updated = removeHarnessHooks(existing)
  writeSettings(settingsPath, updated)
  console.log(chalk.green(`Instrumented harness disabled. Tages hooks removed from ${settingsPath}.`))
}

export async function harnessStatusCommand(_options: HarnessCommandOptions): Promise<void> {
  const settingsPath = getSettingsPath()
  const settings = readSettings(settingsPath)
  const enabled = isHarnessEnabled(settings)

  console.log()
  console.log(chalk.bold('Instrumented Harness Status'))
  console.log(`  ${chalk.bold('Enabled:')} ${enabled ? chalk.green('yes') : chalk.dim('no')}`)

  if (!enabled) {
    console.log(chalk.dim('  Run `tages harness enable` to opt in.'))
    console.log()
    return
  }

  try {
    await loadHarnessLogModule()
    const dbPath = getHarnessDbPathFn(process.cwd())
    if (!fs.existsSync(dbPath)) {
      console.log(`  ${chalk.bold('Pending events:')} 0`)
      console.log(`  ${chalk.bold('Last sync:')} never`)
      console.log()
      return
    }

    const log = new HarnessLogCtor(dbPath)
    try {
      console.log(`  ${chalk.bold('Pending events:')} ${log.pendingCount()}`)
      console.log(`  ${chalk.bold('Last sync:')} ${log.lastSyncedAt() ?? 'never'}`)
    } finally {
      log.close()
    }
  } catch (err) {
    console.error(chalk.yellow(`  Could not read local harness log: ${(err as Error).message}`))
  }
  console.log()
}

export async function harnessSyncCommand(options: HarnessCommandOptions): Promise<void> {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No cloud project configured. Run `tages init` first.'))
    process.exit(1)
    return
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('harness sync requires a cloud connection.'))
    process.exit(1)
    return
  }

  await loadHarnessLogModule()
  const dbPath = getHarnessDbPathFn(process.cwd())
  if (!fs.existsSync(dbPath)) {
    console.log(chalk.dim('No local harness events to sync.'))
    return
  }

  const BATCH_SIZE = 500
  const log = new HarnessLogCtor(dbPath)

  const firstBatch = log.getUnsynced(BATCH_SIZE)
  if (firstBatch.length === 0) {
    console.log(chalk.dim('No pending harness events to sync.'))
    log.close()
    return
  }

  const spinner = ora('Syncing harness events...').start()

  try {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

    // DRAIN in a loop: a backlog larger than one batch used to upload only the
    // first BATCH_SIZE rows yet still report success, silently stranding the
    // rest. Keep fetching/inserting/marking until nothing is left, reporting
    // the TRUE total uploaded. Each insert is still ONE batched call.
    let totalUploaded = 0
    let batch = firstBatch
    while (batch.length > 0) {
      const payload = batch.map((r) => ({
        project_id: config.projectId,
        session_id: r.sessionId,
        agent_name: r.agentName,
        source: r.source,
        tool_name: r.toolName,
        event_type: r.eventType,
        exit_code: r.exitCode,
        file_path: r.filePath,
        duration_ms: r.durationMs,
        args_scrubbed: r.argsScrubbed,
        result_summary: r.resultSummary,
        secrets_redacted_count: r.secretsRedactedCount,
        created_at: r.createdAt,
      }))

      // Supabase's `.from().insert()` returns PromiseLike, not Promise — wrap
      // with Promise.resolve() so `.catch()`/try-catch behave (memory:
      // feedback_supabase_promiselike).
      const { error } = await Promise.resolve(supabase.from('harness_tool_events').insert(payload))

      if (error) {
        spinner.fail(`Sync failed after ${totalUploaded} event(s): ${error.message}`)
        process.exit(1)
        return
      }

      log.markSynced(batch.map((r) => r.id))
      totalUploaded += batch.length
      spinner.text = `Syncing harness events... ${totalUploaded} uploaded`
      batch = log.getUnsynced(BATCH_SIZE)
    }

    spinner.succeed(`Synced ${totalUploaded} harness event(s).`)
  } finally {
    log.close()
  }
}
