import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import { getCacheDir, getProjectsDir } from '../config/paths.js'
import { openCliSync } from './cli-sync.js'

/**
 * Reconcile the local cache with the cloud when the CLI runs.
 *
 * Before this existed, sync was push-only and the local store was refreshed
 * just once, at MCP server startup. A teammate's memory was therefore
 * invisible until you restarted your agent — a step that had to be documented
 * to every new user and that reads, correctly, as the product being broken.
 *
 * Three properties this deliberately has:
 *
 *   - It never blocks or fails a command. Reconciliation improves local state;
 *     if the network is down or auth has expired, the command carries on with
 *     what it already has. A `tages recall` must not die because a pull failed.
 *   - It pushes before it pulls. See `reconcile()` in cli-sync.ts — the reverse
 *     order lets remote state overwrite an unsynced local edit.
 *   - It is rate-limited. Every command invocation paying for a full round trip
 *     would make the CLI feel broken; RECONCILE_TTL_MS collapses bursts.
 */

/**
 * Skip reconciliation if the cache was refreshed within this window.
 *
 * 60s is a deliberate trade: a teammate's memory becomes visible within a
 * minute without any restart, while a burst of commands pays for at most one
 * round trip. `TAGES_SYNC_TTL_MS` overrides it — 0 forces every invocation to
 * reconcile, which is what the end-to-end suite uses to test the pull itself
 * rather than the rate limiter.
 */
export const RECONCILE_TTL_MS = 60_000

export function reconcileTtlMs(): number {
  const raw = process.env.TAGES_SYNC_TTL_MS
  // An empty or whitespace-only value means "unset", not "zero". Number('')
  // is 0, so without this an exported-but-empty TAGES_SYNC_TTL_MS would
  // silently disable rate limiting and put a network round trip in front of
  // every command — a misconfiguration with no symptom other than slowness.
  if (raw === undefined || raw.trim() === '') return RECONCILE_TTL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : RECONCILE_TTL_MS
}

/** Default ceiling on the whole background reconcile, network included. */
const RECONCILE_TIMEOUT_MS = 3_000

export function reconcileTimeoutMs(): number {
  const raw = process.env.TAGES_SYNC_TIMEOUT_MS
  // Same empty-string trap as reconcileTtlMs: Number('') is 0, and a 0ms
  // ceiling would make every reconcile time out instantly and silently.
  if (raw === undefined || raw.trim() === '') return RECONCILE_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : RECONCILE_TIMEOUT_MS
}

/** Sentinel, so a timeout is distinguishable from a legitimately undefined result. */
export const TIMED_OUT = Symbol('reconcile-timed-out')

/**
 * Runs `work` with a ceiling, resolving to TIMED_OUT if the ceiling wins.
 *
 * The loser is not cancelled — there is no AbortSignal threaded through the
 * Supabase client — so the timer is unref'd and the abandoned promise gets a
 * no-op catch. Without that catch a later rejection from the abandoned work
 * would surface as an unhandled rejection long after this function returned,
 * crashing a command that had already moved on.
 */
export async function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const started = work().catch((err) => {
    throw err
  })
  started.catch(() => {})
  try {
    return await Promise.race([
      started,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
        if (typeof timer.unref === 'function') timer.unref()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Commands that must NOT trigger a reconcile.
 *
 * `link`/`init` run before a project config exists. `login`/`logout` change the
 * identity a reconcile would authenticate as. `doctor` reports on state and
 * must not repair it, or it would mask the very problem it is asked to
 * diagnose. The `harness`/`token` groups are unrelated to memory content.
 */
const SKIP = new Set(['init', 'link', 'login', 'logout', 'whoami', 'doctor', 'token', 'harness', 'dashboard', 'onboard'])

export function shouldSkipReconcile(commandName: string | undefined): boolean {
  return !commandName || SKIP.has(commandName)
}

/**
 * True when the cache is stale enough to be worth refreshing.
 * Exported for tests; `lastSyncedAt` is an ISO string or null.
 */
export function isStale(lastSyncedAt: string | null, now: number = Date.now(), ttlMs: number = reconcileTtlMs()): boolean {
  if (!lastSyncedAt) return true
  const parsed = Date.parse(lastSyncedAt)
  if (Number.isNaN(parsed)) return true
  return now - parsed >= ttlMs
}

/**
 * Marker recording when a reconcile was last ATTEMPTED, as opposed to when one
 * last pulled rows.
 *
 * The cache's own `last_synced_at` is not usable as a rate-limit clock:
 * `SupabaseSync.hydrate()` only stamps it on the two paths that actually
 * pulled something, and leaves it untouched on the "cache is current" and
 * "remote is empty" early returns. Rate-limiting on it therefore degrades to
 * no rate limiting at all in the steady state — once the TTL lapses, every
 * subsequent command finds an unchanged timestamp, reconciles, pulls nothing,
 * does not restamp, and the next command is stale again. A quiet project would
 * put a flush plus two `count=exact` round trips in front of every invocation,
 * forever.
 */
function attemptMarkerPath(projectId: string): string {
  return path.join(getCacheDir(), `.reconcile-${projectId}`)
}

export function lastAttemptAt(projectId: string): number | null {
  try {
    return fs.statSync(attemptMarkerPath(projectId)).mtimeMs
  } catch {
    return null
  }
}

export function recordAttempt(projectId: string): void {
  try {
    const p = attemptMarkerPath(projectId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '')
  } catch {
    // A marker we cannot write costs an extra round trip, never correctness.
  }
}

/**
 * Resolve a project config WITHOUT the exit-on-ambiguity behaviour of
 * `loadProjectConfig`, which ends in `return process.exit(1)` when several
 * projects are configured and the cwd matches none of them
 * (config/project.ts). A `process.exit` cannot be caught, so calling it from
 * this hook would kill commands that never needed a project at all — `tages
 * templates list` and `tages federation list` resolve no config today and work
 * from any directory.
 *
 * Ambiguity here simply means "do not reconcile": the hook is an optimisation,
 * so declining is always a safe answer.
 */
function resolveConfigQuietly(slug?: string): Record<string, unknown> | null {
  try {
    const dir = getProjectsDir()
    if (!fs.existsSync(dir)) return null

    const read = (file: string) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
      } catch {
        return null // corrupt config is the user's problem to see elsewhere, not ours to exit on
      }
    }

    if (slug) {
      const p = path.join(dir, `${slug}.json`)
      return fs.existsSync(p) ? read(p) : null
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    if (files.length === 1) return read(path.join(dir, files[0]))

    // Several projects configured: only act when the cwd unambiguously names
    // one, walking up exactly as detectSlugFromCwd does. Never guess.
    let cwd = process.cwd()
    for (;;) {
      const marker = path.join(cwd, '.tages', 'config.json')
      if (fs.existsSync(marker)) {
        const detected = read(marker)?.slug
        if (typeof detected === 'string') {
          const p = path.join(dir, `${detected}.json`)
          return fs.existsSync(p) ? read(p) : null
        }
      }
      const candidate = path.join(dir, `${path.basename(cwd)}.json`)
      if (fs.existsSync(candidate)) return read(candidate)
      const parent = path.dirname(cwd)
      if (parent === cwd) return null
      cwd = parent
    }
  } catch {
    return null
  }
}

/**
 * @param commandName the top-level command being run
 * @param opts.force  ignore the TTL (used by `tages sync`)
 * @param opts.slug   explicit project slug, when the command was given one
 */
export async function autoReconcile(
  commandName: string | undefined,
  opts: { force?: boolean; slug?: string } = {},
): Promise<void> {
  if (!opts.force && shouldSkipReconcile(commandName)) return

  // A holder rather than a bare `let`, because the open happens inside the
  // timed closure below. If the timeout wins the race the closure keeps running
  // and may still open the cache, so the handle has to be reachable from the
  // `finally` or it leaks an open SQLite connection on every timed-out run.
  const held: { ctx: Awaited<ReturnType<typeof openCliSync>> | null } = { ctx: null }
  try {
    const config = resolveConfigQuietly(opts.slug)
    const projectId = typeof config?.projectId === 'string' ? config.projectId : null
    // No project here, or a local-only project: nothing to reconcile against.
    if (!projectId || !config?.supabaseUrl) return

    // Rate-limit on the last ATTEMPT, not the last successful pull — see
    // attemptMarkerPath. Stamped before the work so a slow or failing
    // reconcile cannot be retried by every command in a burst.
    if (!opts.force) {
      const last = lastAttemptAt(projectId)
      if (last !== null && Date.now() - last < reconcileTtlMs()) return
    }
    recordAttempt(projectId)

    // Bounded, because "never fails" is not "never blocks". This runs from a
    // preAction hook in front of nearly every command, and every network call
    // underneath it — setSession, a possible refreshSession, the count probes,
    // the select — goes through the global fetch with no AbortSignal. A hard
    // refusal fails fast, but a captive portal or a firewall that completes the
    // TCP handshake and then never answers falls through to undici's 300s
    // headersTimeout, which would hang `tages recall` for five minutes on a
    // background task the user never asked for.
    //
    // Declining is always a safe answer here: the reconcile is opportunistic,
    // the attempt is already stamped so a burst will not retry it, and the next
    // command past the TTL tries again.
    const timed = await withTimeout(async () => {
      held.ctx = await openCliSync(config as never)
      return held.ctx.reconcile()
    }, reconcileTimeoutMs())

    if (timed === TIMED_OUT) {
      console.error(
        chalk.dim(`[tages] Background sync: skipped, the server did not respond within ${reconcileTimeoutMs()}ms`),
      )
      return
    }
    const result = timed

    // Only ever a dim note on stderr. This is background maintenance the user
    // did not ask for, so it must not compete with the output of the command
    // they did ask for — but a push that failed is still surfaced, because
    // that means their memories are not reaching their team.
    //
    // `alreadyReported` suppresses the duplicate: openCliSync prints its own
    // "Could not set up cloud sync" line, and echoing it here would show an
    // expired-session user two warnings before every single command.
    if (result.error && !result.alreadyReported) {
      console.error(chalk.dim(`[tages] Background sync: ${result.error}`))
    } else if (result.pulled > 0) {
      console.error(chalk.dim(`[tages] Pulled ${result.pulled} updated ${result.pulled === 1 ? 'memory' : 'memories'}.`))
    }
  } catch (err) {
    // Deliberately swallowed. Reconciliation is best-effort; a failure here
    // must never change the exit status or output of the user's command.
    console.error(chalk.dim(`[tages] Background sync skipped: ${(err as Error).message}`))
  } finally {
    try {
      held.ctx?.close()
    } catch {
      /* closing a cache we may never have fully opened is not worth reporting */
    }
  }
}
