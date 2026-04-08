import * as fs from 'fs'
import chalk from 'chalk'
import { getCacheDir, getAuthPath } from '../config/paths.js'
import { createAuthenticatedClient } from '../auth/session.js'

// @ts-ignore — cross-package import, rootDir expanded in tsconfig
import { SqliteCache } from '../../../server/src/cache/sqlite.js'
// @ts-ignore — cross-package import, rootDir expanded in tsconfig
import { SupabaseSync } from '../../../server/src/sync/supabase-sync.js'

export interface ProjectConfig {
  projectId: string
  slug?: string
  supabaseUrl?: string
  supabaseAnonKey?: string
  [key: string]: unknown
}

export interface CliSyncContext {
  cache: SqliteCache
  flush: () => Promise<void>
  close: () => void
}

/**
 * Opens a SqliteCache (and optionally SupabaseSync) from a project config.
 *
 * Local mode (no supabaseUrl): cache only, flush is a no-op.
 * Cloud mode (supabaseUrl present): cache + sync, flush pushes dirty records.
 */
export async function openCliSync(config: ProjectConfig): Promise<CliSyncContext> {
  const cacheDir = getCacheDir()
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  const dbPath = `${cacheDir}/${config.slug || config.projectId}.db`
  const cache = new SqliteCache(dbPath)

  // Local mode — no Supabase URL configured
  if (!config.supabaseUrl) {
    return {
      cache,
      flush: async () => {
        // no-op in local mode
      },
      close: () => {
        cache.close()
      },
    }
  }

  // Cloud mode — set up SupabaseSync with auth
  let sync: InstanceType<typeof SupabaseSync> | null = null

  try {
    const anonKey = config.supabaseAnonKey || ''
    const supabase = await createAuthenticatedClient(config.supabaseUrl, anonKey)
    sync = new SupabaseSync(supabase, cache, config.projectId)
  } catch (err) {
    // Auth setup failed — fall back to local mode with a warning
    console.error(
      chalk.dim(`[tages] Could not set up cloud sync: ${(err as Error).message}. Operating in local mode.`)
    )
  }

  return {
    cache,
    flush: async () => {
      if (!sync) return
      try {
        await sync.flush()
      } catch (err) {
        console.error(
          chalk.dim(`[tages] Sync flush warning: ${(err as Error).message}`)
        )
        // Never throw — flush failures are non-fatal
      }
    },
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
