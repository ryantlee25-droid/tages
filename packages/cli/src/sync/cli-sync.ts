import * as fs from 'fs'
import chalk from 'chalk'
import { getCacheDir, getAuthPath } from '../config/paths.js'
import { createAuthenticatedClient } from '../auth/session.js'

/**
 * The two `@tages/server` modules the CLI needs to read and push the local
 * cache. They are imported FROM SOURCE and compiled into the CLI bundle by
 * tsup, which is the only form that works in all three environments the CLI
 * runs in:
 *
 *   - published npm install — there is no sibling `packages/server` on disk
 *   - monorepo clone + `pnpm link --global` — there is, but it need not be built
 *   - `tsx` / vitest running straight off `src/`
 *
 * This replaces a filesystem walk that looked for
 * `packages/server/dist/cache/sqlite.js` up to ten directories above this
 * file. That path only ever exists in a monorepo checkout, so every command
 * that syncs (`remember`, `forget`, `import`, `import-memories`, `index`)
 * threw `Failed to load server modules` for anyone who installed from npm.
 * The walk also made the CJS server `dist/` the thing being loaded, which is
 * why the loader needed `createRequire` interop at all; bundling from source
 * removes the module-format mismatch instead of bridging it.
 *
 * Kept as a lazy `await import()` rather than a top-level import so the
 * SQLite-backed module body is not evaluated by commands that never sync.
 */
let SqliteCache: any
let SupabaseSync: any

async function loadServerModules() {
  if (SqliteCache) return
  try {
    // @ts-ignore — cross-package source import, inlined by tsup
    const sqliteModule = await import('../../../server/src/cache/sqlite.js')
    SqliteCache = sqliteModule.SqliteCache
    // @ts-ignore — cross-package source import, inlined by tsup
    const syncModule = await import('../../../server/src/sync/supabase-sync.js')
    SupabaseSync = syncModule.SupabaseSync
    if (!SqliteCache || !SupabaseSync) {
      throw new Error('server modules loaded but did not export SqliteCache/SupabaseSync')
    }
  } catch (e) {
    throw new Error(`Failed to load server modules: ${(e as Error).message}`)
  }
}

export interface ProjectConfig {
  projectId: string
  slug?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
  [key: string]: unknown
}

/**
 * Outcome of a sync flush.
 *
 * `ok: true` means every locally-dirty memory reached Supabase, OR there was
 * nowhere to push it (local mode, no cloud configured) — i.e. nothing was
 * silently lost. `ok: false` means the memory is still sitting in local SQLite
 * with dirty=1 and no teammate can see it; `error` says why.
 */
export interface FlushResult {
  ok: boolean
  /** Populated only when `ok` is false. */
  error?: string
}

export interface CliSyncContext {
  cache: any  // SqliteCache instance (dynamically imported)
  /**
   * Best-effort push that never throws and discards the outcome.
   * Used by the bulk commands (import, import-memories, index) which print
   * their own aggregate summary. Delegates to `flushWithResult`.
   */
  flush: () => Promise<void>
  /**
   * Push dirty rows and report whether they actually landed in Supabase.
   * Any caller that prints a per-memory success line to a human must use this
   * instead of `flush` — otherwise a failed cloud write is reported as success.
   */
  flushWithResult: () => Promise<FlushResult>
  close: () => void
}

/**
 * Ids of the memories currently marked dirty (unsynced) in the local cache.
 * Defensive: a caller may hand us a partial/mocked cache with no getDirty.
 * An unreadable cache yields an empty list, which degrades to the previous
 * "assume success" behaviour rather than reporting a spurious failure.
 */
function dirtyMemoryIds(cache: any): string[] {
  try {
    const rows = typeof cache?.getDirty === 'function' ? cache.getDirty() : []
    return Array.isArray(rows) ? rows.map((r: { id: string }) => r.id) : []
  } catch {
    return []
  }
}

/**
 * Opens a SqliteCache (and optionally SupabaseSync) from a project config.
 *
 * Local mode (no supabaseUrl): cache only, flush is a no-op.
 * Cloud mode (supabaseUrl present): cache + sync, flush pushes dirty records.
 */
export async function openCliSync(config: ProjectConfig): Promise<CliSyncContext> {
  await loadServerModules()
  const cacheDir = getCacheDir()
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  const dbPath = `${cacheDir}/${config.slug || config.projectId}.db`
  const cache = new SqliteCache(dbPath)

  // Local mode — no Supabase URL configured
  if (!config.supabaseUrl) {
    // Nothing to push and nowhere to push it: a local-only write is the
    // configured behaviour here, not a silent failure, so report ok.
    const flushWithResult = async (): Promise<FlushResult> => ({ ok: true })
    return {
      cache,
      flush: async () => {
        await flushWithResult()
      },
      flushWithResult,
      close: () => {
        cache.close()
      },
    }
  }

  // Cloud mode — set up SupabaseSync with auth
  let sync: InstanceType<typeof SupabaseSync> | null = null
  let setupError: string | null = null

  try {
    const anonKey = config.supabaseAnonKey || ''
    const supabase = await createAuthenticatedClient(config.supabaseUrl, anonKey)
    sync = new SupabaseSync(supabase, cache, config.projectId)
  } catch (err) {
    // Auth setup failed — fall back to local mode with a warning
    setupError = (err as Error).message
    console.error(
      chalk.dim(`[tages] Could not set up cloud sync: ${setupError}. Operating in local mode.`)
    )
  }

  const flushWithResult = async (): Promise<FlushResult> => {
    if (!sync) {
      // Cloud sync WAS configured for this project but the client could never
      // be built (missing/expired auth). The write stays local — that is a
      // failure to report, not a local-mode success.
      return { ok: false, error: setupError || 'cloud sync is unavailable' }
    }

    // Snapshot what we are about to push. SupabaseSync.markSynced() clears
    // dirty=1 only after a successful upsert, so rows that are STILL dirty
    // once flush() resolves are rows that never reached Supabase. This is the
    // authoritative signal, because awaiting sync.flush() on its own tells us
    // nothing: _flushMemories() catches the Supabase error, logs it, and
    // returns normally (packages/server/src/sync/supabase-sync.ts).
    const pendingIds = dirtyMemoryIds(cache)

    // Recover the underlying reason from that swallowed log line. console.error
    // is teed, not replaced: every message is still forwarded untouched, we
    // only keep a copy of the sync failures. Remove this shim once
    // SupabaseSync.flush() reports a result of its own.
    const swallowed: string[] = []
    const realConsoleError = console.error
    console.error = (...args: unknown[]) => {
      const line = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
      if (line.includes('Sync flush failed') || line.includes('Sync error')) {
        swallowed.push(
          line.replace(/^\[tages\]\s*/, '').replace(/^Sync (?:flush failed|error):\s*/, '')
        )
      }
      realConsoleError(...args)
    }

    try {
      await sync.flush()
    } catch (err) {
      // Never rethrow — flush failures are non-fatal, but they ARE reported.
      return { ok: false, error: (err as Error).message }
    } finally {
      console.error = realConsoleError
    }

    const stillDirty = dirtyMemoryIds(cache).filter((id) => pendingIds.includes(id))
    if (stillDirty.length > 0) {
      return {
        ok: false,
        error:
          swallowed[0] ||
          `${stillDirty.length} ${stillDirty.length === 1 ? 'memory' : 'memories'} still marked unsynced locally`,
      }
    }

    return { ok: true }
  }

  return {
    cache,
    flush: async () => {
      // Outcome-discarding wrapper for bulk callers. It still surfaces the
      // reason on stderr so nothing regresses to a fully silent failure.
      const result = await flushWithResult()
      if (!result.ok) {
        console.error(chalk.dim(`[tages] Sync flush warning: ${result.error}`))
      }
    },
    flushWithResult,
    close: () => {
      if (sync) {
        try {
          sync.stopSync()
        } catch {
          // ignore close errors
        }
      }
      cache.close()
    },
  }
}
