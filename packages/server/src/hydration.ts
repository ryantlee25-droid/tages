import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from './cache/sqlite'
import type { SupabaseSync } from './sync/supabase-sync'
import { runEmbeddingBackfill } from './sync/embedding-backfill'

/**
 * Determine whether the local cache should be hydrated from Supabase.
 * Returns true if the cache is stale or has never been synced.
 *
 * No longer gates boot (0.5.7: boot always runs the cheap delta check, since
 * CLI reconcile writes the same SQLite file and masks staleness). Kept for
 * callers and tests that want an age check.
 */
export function shouldHydrate(lastSync: string | null, ttlMs: number = 60_000): boolean {
  if (!lastSync) return true
  const age = Date.now() - new Date(lastSync).getTime()
  return age >= ttlMs
}

/** Read tools refresh the cache when the last successful hydrate is older than this. */
export const READ_FRESHNESS_MS = 15_000
/**
 * How long the FIRST read after boot waits for the boot hydrate. The MCP
 * handshake never waits on it; a read does, so a restarted agent sees
 * teammates' memories written while it was down. Fail-open: after this the
 * read serves the cache.
 */
export const BOOT_READ_WAIT_MS = 10_000

type BootSync = Pick<SupabaseSync, 'hydrate'>

export interface BootFreshness {
  /** Resolves when the boot hydrate finished (or failed). Never rejects. */
  hydrated: Promise<void>
  /** Resolves with rows attempted once the post-hydrate backfill finished. Never rejects. */
  backfill: Promise<number>
}

/**
 * Start the boot hydrate unconditionally and chain the bounded embedding
 * backfill after it. Returns immediately: neither promise belongs on the
 * boot critical path.
 */
export function startBootFreshness(
  sync: SupabaseSync,
  cache: SqliteCache,
  projectId: string,
  supabaseClient?: SupabaseClient,
  deps: {
    backfill?: typeof runEmbeddingBackfill
  } = {},
): BootFreshness {
  const backfillFn = deps.backfill ?? runEmbeddingBackfill
  const hydrated = Promise.resolve()
    .then(() => (sync as BootSync).hydrate())
    .then(
      (count) => {
        if (count > 0) console.error(`[tages] Hydrated ${count} memories from Supabase`)
      },
      (err) => {
        console.error('[tages] Boot hydration failed, serving the cache:', (err as Error)?.message)
      },
    )
  const backfill = hydrated
    .then(() => backfillFn(projectId, cache, sync, supabaseClient))
    .catch((err) => {
      console.error('[tages] Embedding backfill failed:', (err as Error)?.message)
      return 0
    })
  return { hydrated, backfill }
}

/**
 * Build the freshness step the read tools (recall, conventions,
 * project_brief) run before reading the cache. Waits (capped) for the boot
 * hydrate on the first reads, then `hydrateIfStale(READ_FRESHNESS_MS)`.
 * Never throws.
 */
export function createReadFreshener(
  sync: Pick<SupabaseSync, 'hydrateIfStale'> | null,
  bootHydrated: Promise<void> | null,
  opts: { bootWaitMs?: number; maxAgeMs?: number } = {},
): () => Promise<void> {
  const bootWaitMs = opts.bootWaitMs ?? BOOT_READ_WAIT_MS
  const maxAgeMs = opts.maxAgeMs ?? READ_FRESHNESS_MS
  let bootDone = bootHydrated === null
  void bootHydrated?.then(() => {
    bootDone = true
  })
  return async () => {
    if (!sync) return
    try {
      if (!bootDone && bootHydrated) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const cap = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, bootWaitMs)
          timer.unref?.()
        })
        try {
          await Promise.race([bootHydrated, cap])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      await sync.hydrateIfStale(maxAgeMs)
    } catch {
      // fail open: serve the cache
    }
  }
}
