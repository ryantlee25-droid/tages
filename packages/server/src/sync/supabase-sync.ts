import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import { SyncWAL } from '../cache/sync-wal'

const SYNC_INTERVAL_MS = 60_000
/** PostgREST's default max rows per response. */
const PAGE_SIZE = 1000
/** How long the read path waits before retrying a failed dirty push. */
const FLUSH_RETRY_BACKOFF_MS = 60_000
/** remoteGetByKeys batch size (keeps the `in.(...)` URL well under limits). */
const KEY_BATCH = 100
/**
 * W1 skew window. INSERT keeps the writer's `updated_at` (the trigger is
 * BEFORE UPDATE only) and `now()` is the transaction start, so a row can sit
 * at or below the watermark although we have not seen it. 10 minutes is twice
 * the 5-minute clock-skew bound Kerberos and most auth stacks tolerate, and
 * dwarfs Supabase's 8s statement timeout for the `authenticated` role (the
 * longest a transaction's now() can trail its commit).
 */
export const SKEW_MARGIN_MS = 10 * 60_000
/** W1 clamp: the stored watermark never exceeds the local clock by more than this. */
const WATERMARK_CLAMP_EPSILON_MS = 1_000
/** W3: per-request abort timeout on hydrate's Supabase queries. */
const DEFAULT_QUERY_TIMEOUT_MS = 10_000
/** S2: max dirty keys excluded from the count comparison by name (they go in the URL). */
const DIRTY_EXCLUDE_MAX = 100
/** Encoded `not.in` list budget; well under common 8 KB proxy URL limits. */
const DIRTY_EXCLUDE_MAX_URL_CHARS = 4000

export class SupabaseSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private wal: SyncWAL | null = null
  /** Simple promise-chain mutex to prevent flush() racing with remoteDelete(). */
  private flushQueue: Promise<void> = Promise.resolve()
  /** In-flight hydrate, shared by concurrent callers. */
  private hydrating: Promise<number> | null = null
  /** In-flight hydrateIfStale run (wraps hydrate, never rejects). */
  private staleRun: Promise<void> | null = null
  /** ms epoch of the last hydrate that completed without error. */
  private lastHydrateOkAt = 0
  /** ms epoch of the last failed dirty push (0 = last push succeeded). */
  private lastFlushFailedAt = 0
  /** ms epoch of the last hydrateIfStale attempt (success or failure). */
  private lastHydrateAttemptAt = 0
  /** ms epoch the in-flight staleRun started (W3: callers share its wait budget). */
  private staleRunStartedAt = 0
  /** Local ms epoch the last skew-window (or full) listing started (W1). 0 = never in this process. */
  private windowCheckedAt = 0
  /** Per-request abort timeout for hydrate's queries (W3). Tests lower it. */
  queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS

  constructor(
    private supabase: SupabaseClient,
    private cache: SqliteCache,
    private projectId: string,
    walPath?: string,
  ) {
    if (walPath) {
      this.wal = new SyncWAL(walPath)
    }
  }

  /**
   * The authenticated client this sync was built from. Callers that were not
   * threaded a client (embedOnWrite from observe/session_end/verify) reuse it
   * so the hosted embedding provider gets the caller's session.
   */
  get client(): SupabaseClient {
    return this.supabase
  }

  /** Enqueue work on the flush serialisation queue (prevents resurrection races). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.flushQueue.then(fn)
    // Keep the queue moving even if this task throws
    this.flushQueue = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Recover any incomplete WAL operations from a previous crash.
   * Should be called on startup before hydration.
   */
  async recoverWAL(): Promise<number> {
    if (!this.wal) return 0
    const incomplete = this.wal.getIncomplete()
    if (incomplete.length === 0) return 0

    console.error(`[tages] WAL recovery: replaying ${incomplete.length} incomplete operations`)
    let recovered = 0

    for (const op of incomplete) {
      try {
        if (op.operation === 'upsert') {
          const memory = JSON.parse(op.payload) as Memory
          const { id: _id, ...rowWithoutId } = memoryToDbRow(memory)
          const { error } = await this.supabase
            .from('memories')
            .upsert(rowWithoutId, { onConflict: 'project_id,key' })
          if (!error) {
            this.wal.markComplete(op.id)
            recovered++
          }
        } else if (op.operation === 'delete') {
          const key = JSON.parse(op.payload) as string
          const { error } = await this.supabase
            .from('memories')
            .delete()
            .eq('project_id', op.projectId)
            .eq('key', key)
          if (!error) {
            this.wal.markComplete(op.id)
            recovered++
          }
        }
      } catch (err) {
        console.error(`[tages] WAL recovery failed for op ${op.id}:`, (err as Error).message)
      }
    }

    console.error(`[tages] WAL recovery complete: ${recovered}/${incomplete.length} recovered`)
    return recovered
  }

  /**
   * Bring the local cache in line with the shared store. Returns the number of
   * local rows changed (upserted + deleted); 0 means the cache was current or
   * the pull failed (failures are logged, never thrown).
   *
   * Order and rules (0.5.7, bugs 2 and 3, review W1-W3, S2):
   * 1. Push first (`flush()`, on the same queue as remoteDelete), so clean rows
   *    legitimately lose to remote state and an in-flight forget lands before
   *    we pull. Whatever is still dirty afterwards failed to push and is never
   *    overwritten or deleted.
   * 2. Fast path: nothing changed since the watermark and the row counts match.
   *    Dirty keys are excluded from both sides of the count (S2), so a
   *    read-only member's unpushable writes do not force a listing forever.
   * 3. Delta: rows with `updated_at > watermark`. Status changes (archive,
   *    pending) arrive here: the `memories_updated_at` trigger bumps
   *    `updated_at` on every UPDATE.
   * 4. Skew window (W1): `updated_at` on INSERT is the writer's clock, and
   *    `now()` is the transaction START, not its commit. Either can put a
   *    later edit at or below the watermark. Until a listing has run at least
   *    SKEW_MARGIN_MS (local clock) past the watermark, the delta lists
   *    `(key, updated_at)` from `watermark - SKEW_MARGIN_MS` and fetches only
   *    the keys that differ from the cache.
   * 5. Reconcile when the counts differ: list remote keys, delete clean local
   *    rows the remote no longer has (a teammate's forget), and fetch any key
   *    that is missing or differs locally.
   * 6. Full pull when there is no usable watermark, then the same deletion
   *    reconcile.
   *
   * Listings page by keyset on `id` (W2), and deletions skip rows synced
   * after the listing started (W2). Every request carries an abort timeout
   * (W3) so a hung connection cannot pin the single-flight run forever.
   *
   * The watermark is the max SERVER `updated_at` applied, clamped to the
   * local clock (W1), and held when a row was skipped to protect a dirty
   * edit.
   *
   * Single-flight: concurrent callers share one run.
   */
  async hydrate(opts: { skipFlush?: boolean } = {}): Promise<number> {
    if (this.hydrating) return this.hydrating
    const run = this._hydrate(opts).finally(() => {
      this.hydrating = null
    })
    this.hydrating = run
    return run
  }

  private async _hydrate(opts: { skipFlush?: boolean } = {}): Promise<number> {
    try {
      // skipFlush: the caller just pushed (the CLI reconcile). After a failed
      // push, wait FLUSH_RETRY_BACKOFF_MS before the read path retries it: an
      // unpushable row (read-only member) would otherwise cost a doomed upsert
      // on every 15s freshen. The 60s interval flush still retries it.
      if (!opts.skipFlush && Date.now() - this.lastFlushFailedAt >= FLUSH_RETRY_BACKOFF_MS) {
        await this.flush()
      }

      const watermark = this.cache.getRemoteWatermark(this.projectId)
      const localCount = this.cache.getMemoryCount(this.projectId)

      if (watermark && localCount > 0) {
        const startedAt = Date.now()
        const wmMs = Date.parse(watermark)
        // Hot until a window listing has started SKEW_MARGIN_MS past the watermark.
        const hot = Number.isNaN(wmMs) || this.windowCheckedAt < wmMs + SKEW_MARGIN_MS

        // S2: dirty keys leave both counts (bounded: the list goes in the URL).
        const dirtyKeys = this.cache.getSyncIndex(this.projectId).filter((r) => r.dirty).map((r) => r.key)
        // Cap by URL length too: 100 long keys can pass a proxy's URL limit
        // (414), which would turn every 15s freshen into a full pull.
        const exclude = dirtyKeys.length <= DIRTY_EXCLUDE_MAX && pgInList(dirtyKeys).length <= DIRTY_EXCLUDE_MAX_URL_CHARS
          ? new Set(dirtyKeys)
          : new Set<string>()
        const comparableLocal = () =>
          exclude.size === 0
            ? this.cache.getMemoryCount(this.projectId)
            : this.cache.getSyncIndex(this.projectId).filter((r) => !exclude.has(r.key)).length

        // Hot runs list the window anyway, so they skip the delta head count.
        let changed: number | null = null
        let changedFailed = false
        if (!hot) {
          const res = await this.timed(
            this.supabase
              .from('memories')
              .select('*', { count: 'exact', head: true })
              .eq('project_id', this.projectId)
              .gt('updated_at', watermark),
          )
          changed = typeof res.count === 'number' ? res.count : null
          changedFailed = !!res.error || changed === null
        }
        let totalQuery = this.supabase
          .from('memories')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', this.projectId)
        if (exclude.size > 0) totalQuery = totalQuery.not('key', 'in', pgInList([...exclude]))
        const { count: remoteTotal, error: totalError } = await this.timed(totalQuery)

        if (!changedFailed && !totalError && typeof remoteTotal === 'number') {
          if (!hot && changed === 0 && remoteTotal === comparableLocal()) {
            console.error(`[tages] Cache is current (${localCount} memories, watermark: ${watermark})`)
            this.lastHydrateOkAt = Date.now()
            return 0
          }

          let touched = 0
          let held = 0
          let maxSeen: string | null = null

          if (hot) {
            const win = await this.reconcileWindow(shiftTimestamp(watermark, -SKEW_MARGIN_MS))
            if (win === null) {
              held += 1
            } else {
              touched += win.applied
              held += win.held
              maxSeen = maxTimestamp(maxSeen, win.maxUpdatedAt ? [win.maxUpdatedAt] : [])
              this.windowCheckedAt = startedAt
            }
          } else if (changed !== null && changed > 0) {
            console.error(`[tages] Delta sync: ${changed} memories changed since ${watermark}`)
            const rows = await this.pageAll<DbRow>((q) => q.gt('updated_at', watermark))
            if (rows === null) return 0
            const local = new Map(this.cache.getSyncIndex(this.projectId).map((r) => [r.key, r]))
            // A row the cache already holds at this revision (the W1 clamp can
            // re-match it) is not re-applied.
            const memories = rows.map(dbRowToMemory).filter((m) => {
              const l = local.get(m.key)
              return !l || l.dirty || !sameInstant(l.updatedAt, m.updatedAt)
            })
            const result = this.cache.hydrateFromRemote(memories)
            touched += result.applied
            held += result.skipped.length
            maxSeen = maxTimestamp(maxSeen, rows.map((r) => r.updated_at))
          }

          if (remoteTotal !== comparableLocal()) {
            const rec = await this.reconcileByListing(remoteTotal, exclude)
            if (rec === null) {
              // Listing failed or raced a concurrent write: keep what was
              // applied, hold the watermark, retry next time.
              held += 1
            } else {
              touched += rec.applied + rec.deleted
              held += rec.held
              maxSeen = maxTimestamp(maxSeen, rec.maxUpdatedAt ? [rec.maxUpdatedAt] : [])
            }
          }

          this.advanceWatermark(maxSeen, held)
          this.lastHydrateOkAt = Date.now()
          return touched
        }
        // A count query failed: fall through to the full pull.
      }

      // Full hydration: first run, legacy local-clock watermark, or count failure.
      const startedAt = Date.now()
      const rows = await this.pageAll<DbRow>((q) => q)
      if (rows === null) return 0
      if (rows.length === 0) {
        // An empty answer alone never mass-deletes: a dead session under RLS
        // reads as an empty project. Only a separate exact count of 0 under a
        // verified session reconciles (a teammate forgot the last memory).
        const deleted = await this.reconcileConfirmedEmpty(startedAt)
        this.lastHydrateOkAt = Date.now()
        return deleted
      }
      const memories = rows.map(dbRowToMemory)
      const result = this.cache.hydrateFromRemote(memories)
      // Same guard as reconcileByListing: delete only when an exact count
      // agrees with the listing. A failed count or a mismatch (truncated
      // listing, or a write that raced it) applies rows but deletes nothing.
      const { count: remoteTotal, error: countError } = await this.timed(
        this.supabase
          .from('memories')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', this.projectId),
      )
      const listingComplete = !countError && remoteTotal === rows.length
      let deleted = 0
      if (listingComplete) {
        const remoteKeys = new Set(memories.map((m) => m.key))
        const gone = this.cache
          .getSyncIndex(this.projectId)
          .filter((r) => !r.dirty && !remoteKeys.has(r.key))
          .map((r) => r.key)
        deleted = this.cache.deleteCleanByKeys(this.projectId, gone, { syncedBefore: startedAt })
        if (deleted > 0) console.error(`[tages] Removed ${deleted} memories deleted from the shared store`)
      } else {
        console.error('[tages] Full sync: listing and count disagree, skipping deletions this round')
      }
      this.advanceWatermark(
        maxTimestamp(null, memories.map((m) => m.updatedAt)),
        result.skipped.length + (listingComplete ? 0 : 1),
      )
      this.windowCheckedAt = startedAt
      this.lastHydrateOkAt = Date.now()
      return result.applied + deleted
    } catch (err) {
      console.error('[tages] Hydration error:', (err as Error).message)
      return 0
    }
  }

  /**
   * Advance the watermark to the max server `updated_at` applied, unless a
   * row was skipped to protect an unsynced local edit. Advancing past it would
   * push that revision outside every future `updated_at > watermark` window,
   * and the fast path would then report the key current forever. Holding costs
   * one redundant delta query.
   *
   * W1 clamp: never store a watermark later than the local clock (plus a
   * small epsilon). A teammate whose clock runs ahead inserts rows with a
   * future `updated_at`; storing that would hide every edit whose server
   * `now()` is below it, well past the skew window. A clamped watermark can
   * re-match such a row; the delta skips rows the cache already holds at that
   * revision.
   */
  private advanceWatermark(maxSeen: string | null, held: number): void {
    if (held > 0) {
      console.error(
        `[tages] Held sync watermark: ${held} remote update(s) deferred behind unsynced local edits or an incomplete reconcile`,
      )
      return
    }
    if (!maxSeen) return
    const ceiling = Date.now() + WATERMARK_CLAMP_EPSILON_MS
    const value = Date.parse(maxSeen) > ceiling ? new Date(ceiling).toISOString() : maxSeen
    this.cache.setRemoteWatermark(this.projectId, value, this.cache.getMemoryCount(this.projectId))
  }

  /**
   * Attach the per-request abort timeout (W3). postgrest-js resolves an
   * aborted request as `{ error }`, so callers take their normal error path.
   * Builders without `abortSignal` (minimal test doubles) pass through.
   */
  private timed<Q>(q: Q): Q {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = q as any
    if (b && typeof b.abortSignal === 'function') {
      return b.abortSignal(AbortSignal.timeout(this.queryTimeoutMs)) as Q
    }
    return q
  }

  /**
   * Page through `memories` for this project PAGE_SIZE rows at a time (the
   * PostgREST default cap; a single request silently truncates). Keyset
   * pagination on `id` (W2): with offset paging, a row deleted from an
   * earlier page between requests shifts the next page and silently skips a
   * live row, which a deletion reconcile then deletes locally. Returns null
   * on any error so callers never act on a partial listing.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async pageAll<T extends { id: string }>(filter: (q: any) => any, columns = '*'): Promise<T[] | null> {
    const out: T[] = []
    let lastId: string | null = null
    for (;;) {
      let q = filter(this.supabase.from('memories').select(columns).eq('project_id', this.projectId))
      if (lastId !== null) q = q.gt('id', lastId)
      const { data, error } = await this.timed(q.order('id').limit(PAGE_SIZE))
      if (error) {
        console.error('[tages] Hydration page failed:', error.message)
        return null
      }
      const page = (data || []) as T[]
      // Stop only on an empty page. A short page is not the end: a PostgREST
      // db-max-rows below PAGE_SIZE caps every page, and stopping there would
      // hand a truncated listing to the deletion reconcile.
      if (page.length === 0) return out
      const nextId = page[page.length - 1].id
      // A cursor that does not advance would loop forever: treat as an error.
      if (lastId !== null && !(nextId > lastId)) {
        console.error('[tages] Hydration page cursor did not advance; aborting listing')
        return null
      }
      out.push(...page)
      lastId = nextId
    }
  }

  /**
   * The remote listing came back empty. Delete clean local rows only when the
   * project is CONFIRMED empty: a separate exact head count that succeeded
   * with 0, under a session the auth server accepts. A dead or anonymous
   * session also counts 0 under RLS, so any auth doubt, count error, or
   * non-zero count deletes nothing. Dirty rows are always kept (they are
   * unsynced local writes), and so are rows synced after `listingStartedAt`.
   * Returns rows deleted.
   */
  private async reconcileConfirmedEmpty(listingStartedAt: number): Promise<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const auth = (this.supabase as any).auth
      if (!auth || typeof auth.getUser !== 'function') return 0
      const user = await withTimeout(Promise.resolve(auth.getUser()), this.queryTimeoutMs)
      if (user === TIMED_OUT) return 0
      const { data: userData, error: userError } = user as {
        data?: { user?: { id?: string } | null }
        error?: unknown
      }
      if (userError || !userData?.user?.id) return 0

      const { count, error } = await this.timed(
        this.supabase
          .from('memories')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', this.projectId),
      )
      if (error || count !== 0) return 0

      const gone = this.cache
        .getSyncIndex(this.projectId)
        .filter((r) => !r.dirty)
        .map((r) => r.key)
      if (gone.length === 0) return 0
      const deleted = this.cache.deleteCleanByKeys(this.projectId, gone, { syncedBefore: listingStartedAt })
      if (deleted > 0) console.error(`[tages] Removed ${deleted} memories deleted from the shared store (project is now empty)`)
      return deleted
    } catch (err) {
      console.error('[tages] Empty-project confirm failed, keeping cache:', (err as Error).message)
      return 0
    }
  }

  /**
   * W1 skew window. Lists `(key, updated_at)` for rows newer than `lower` and
   * fetches only keys that are missing locally or whose `updated_at` differs.
   * Dirty keys are held, never overwritten. Null on any failure.
   */
  private async reconcileWindow(lower: string): Promise<{
    applied: number
    held: number
    maxUpdatedAt: string | null
  } | null> {
    const listing = await this.pageAll<{ id: string; key: string; updated_at: string }>(
      (q) => q.gt('updated_at', lower),
      'id, key, updated_at',
    )
    if (listing === null) return null
    const local = new Map(this.cache.getSyncIndex(this.projectId).map((r) => [r.key, r]))
    const toFetch: string[] = []
    let held = 0
    for (const r of listing) {
      const l = local.get(r.key)
      if (!l) {
        toFetch.push(r.key)
      } else if (!sameInstant(l.updatedAt, r.updated_at)) {
        if (l.dirty) held++
        else toFetch.push(r.key)
      }
    }
    let applied = 0
    if (toFetch.length > 0) {
      console.error(`[tages] Delta sync: ${toFetch.length} memories changed since ${lower}`)
      const fetched = await this.remoteGetByKeys(this.projectId, toFetch)
      if (fetched === null) return null
      const result = this.cache.hydrateFromRemote([...fetched.values()])
      applied = result.applied
      held += result.skipped.length
    }
    return { applied, held, maxUpdatedAt: maxTimestamp(null, listing.map((r) => r.updated_at)) }
  }

  /**
   * Count-mismatch reconcile. Lists remote `(key, updated_at)`, deletes clean
   * local rows the remote no longer has, and fetches rows that are missing
   * locally or whose `updated_at` differs. Returns null when the listing failed
   * or did not match `expectedTotal` (a write raced the listing), in which case
   * nothing is deleted. `excluded` keys (dirty locally) were left out of
   * `expectedTotal`, so they are left out of the length check the same way.
   */
  private async reconcileByListing(expectedTotal: number, excluded: Set<string> = new Set()): Promise<{
    applied: number
    deleted: number
    held: number
    maxUpdatedAt: string | null
  } | null> {
    const startedAt = Date.now()
    const listing = await this.pageAll<{ id: string; key: string; updated_at: string }>((q) => q, 'id, key, updated_at')
    if (listing === null) return null
    if (listing.filter((r) => !excluded.has(r.key)).length !== expectedTotal) return null
    // Same empty-answer guard as the full pull.
    if (listing.length === 0) {
      return { applied: 0, deleted: await this.reconcileConfirmedEmpty(startedAt), held: 0, maxUpdatedAt: null }
    }

    const remote = new Map(listing.map((r) => [r.key, r.updated_at]))
    const local = this.cache.getSyncIndex(this.projectId)
    const localByKey = new Map(local.map((r) => [r.key, r]))

    const gone = local.filter((r) => !r.dirty && !remote.has(r.key)).map((r) => r.key)
    const deleted = this.cache.deleteCleanByKeys(this.projectId, gone, { syncedBefore: startedAt })
    if (deleted > 0) console.error(`[tages] Removed ${deleted} memories deleted from the shared store`)

    const toFetch: string[] = []
    let held = 0
    for (const [key, updatedAt] of remote) {
      const l = localByKey.get(key)
      if (!l) {
        toFetch.push(key)
      } else if (!sameInstant(l.updatedAt, updatedAt)) {
        if (l.dirty) held++
        else toFetch.push(key)
      }
    }
    let applied = 0
    if (toFetch.length > 0) {
      const fetched = await this.remoteGetByKeys(this.projectId, toFetch)
      if (fetched === null) return null
      const result = this.cache.hydrateFromRemote([...fetched.values()])
      applied = result.applied
      held += result.skipped.length
    }
    return { applied, deleted, held, maxUpdatedAt: maxTimestamp(null, listing.map((r) => r.updated_at)) }
  }

  /**
   * Fetch-on-read freshness for long-lived MCP sessions. Shares one in-flight
   * hydrate across concurrent callers, does nothing when the last successful
   * hydrate is younger than `maxAgeMs`, and resolves after at most `timeoutMs`
   * (the hydrate keeps running in the background and is reused by the next
   * call). Never throws: on timeout or error the caller serves the cache.
   *
   * A failed attempt also backs off for `maxAgeMs`, so an offline session does
   * not pay the timeout on every read. W3: a caller joining an in-flight run
   * waits only for what is left of that run's `timeoutMs` budget, so a hung
   * run costs one timeout in total, not one per read.
   */
  async hydrateIfStale(maxAgeMs: number, timeoutMs = 2000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const now = Date.now()
      let wait = timeoutMs
      if (this.staleRun) {
        wait = this.staleRunStartedAt + timeoutMs - now
        if (wait <= 0) return
      } else {
        if (now - this.lastHydrateOkAt < maxAgeMs) return
        if (now - this.lastHydrateAttemptAt < maxAgeMs) return
        this.lastHydrateAttemptAt = now
        this.staleRunStartedAt = now
        this.staleRun = this.hydrate()
          .then(() => undefined, () => undefined)
          .finally(() => {
            this.staleRun = null
          })
      }
      const run = this.staleRun
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, wait))
        timer.unref?.()
      })
      await Promise.race([run, timeout])
    } catch {
      // fail open: serve the cache
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  startSync(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.flush(), SYNC_INTERVAL_MS)
  }

  stopSync(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async flush(): Promise<void> {
    return this.enqueue(() => this._flush())
  }

  private async _flush(): Promise<void> {
    await this._flushMemories()
    await this._flushDirtyChunks()
  }

  private async _flushMemories(): Promise<void> {
    const dirty = this.cache.getDirty()
    if (dirty.length === 0) return

    // Log to WAL before remote call for crash safety
    const walIds: string[] = []
    if (this.wal) {
      // Supersede earlier attempts so a row that keeps failing holds one
      // pending entry (its latest payload), not one per retry.
      this.wal.discardPendingByMemoryIds(dirty.map(m => m.id))
      for (const mem of dirty) {
        const walId = this.wal.logPending(mem.id, mem.projectId, 'upsert', memoryToDbRow(mem))
        walIds.push(walId)
      }
    }

    try {
      const rows = dirty.map(m => {
        const { id: _id, ...rest } = memoryToDbRow(m)
        return rest
      })
      const { error } = await this.timed(
        this.supabase
          .from('memories')
          .upsert(rows, { onConflict: 'project_id,key' }),
      )

      if (error) {
        this.lastFlushFailedAt = Date.now()
        console.error('[tages] Sync flush failed:', error.message)
        return
      }
      this.lastFlushFailedAt = 0

      // Q2: a row edited during the upsert await keeps its dirty flag.
      this.cache.markSyncedIfUnchanged(dirty)

      // Mark WAL entries complete after successful sync
      if (this.wal) {
        this.wal.markCompleteByMemoryIds(dirty.map(m => m.id))
      }
    } catch (err) {
      this.lastFlushFailedAt = Date.now()
      console.error('[tages] Sync error:', (err as Error).message)
    }
  }

  /**
   * Push any locally-dirty chunk sets (Task 9) to Supabase. This is what
   * makes the CLI's durable, awaited write path actually reach the remote
   * `memory_chunks` table: `remember.ts` only has `cache` + `flush()`, not a
   * direct `SupabaseSync` reference, so chunk rows ride the same dirty-flag +
   * flush() mechanism the pooled embedding/memory row already uses rather
   * than a separate remote call site.
   */
  private async _flushDirtyChunks(): Promise<void> {
    const groups = this.cache.getDirtyChunkGroups()
    for (const { memoryId, projectId } of groups) {
      // Resolve the local row's (project_id, key) — remoteUpsertChunks is
      // keyed on the business key, not the (divergent) local id.
      const local = this.cache.getKeyById(memoryId)
      if (!local) {
        // Fix F(b): the parent memory is gone locally (forgotten/deleted), so
        // these chunk rows are orphans that will never resolve. Delete them
        // instead of skipping forever (which left them dirty=1 and re-scanned
        // every flush, wasting work and storage).
        this.cache.deleteChunksForMemory(memoryId)
        continue
      }
      // Fix C: capture the SPECIFIC dirty chunk row ids at flush time and clear
      // dirty only for those after the round-trip. A concurrent v2 chunk write
      // (upsertChunks delete-then-insert => fresh ids, dirty=1) landing during
      // the network await below keeps its own dirty flag and syncs next cycle,
      // instead of being clobbered by a memory-wide markChunksSynced(memoryId).
      const dirtyRows = this.cache.getDirtyChunkRows(memoryId)
      const chunks = dirtyRows.map((r) => ({ text: r.text, embedding: r.embedding }))
      const ok = await this.remoteUpsertChunks(projectId, local.key, chunks)
      if (ok) this.cache.markChunksSynced(dirtyRows.map((r) => r.id))
    }
  }

  /**
   * Count memories in Supabase for the project (authoritative source for tier enforcement).
   * Returns null if the query fails (fall back to local count).
   */
  async remoteCountMemories(): Promise<number | null> {
    try {
      const { count, error } = await this.supabase
        .from('memories')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', this.projectId)
      if (error) return null
      return count ?? null
    } catch {
      return null
    }
  }

  async remoteInsert(memory: Memory): Promise<boolean> {
    // Log to WAL before the remote call
    const walId = this.wal?.logPending(memory.id, memory.projectId, 'upsert', memoryToDbRow(memory))

    try {
      const { id: _id, ...rowWithoutId } = memoryToDbRow(memory)
      const { error } = await this.supabase
        .from('memories')
        .upsert(rowWithoutId, { onConflict: 'project_id,key' })

      if (error) {
        console.error('[tages] Remote insert failed:', error.message)
        return false
      }

      if (walId && this.wal) this.wal.markComplete(walId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Null the remote embedding for (project_id, key) after its value changed,
   * so a stale vector is never ranked against new text and the backfill
   * (embedding IS NULL) re-embeds it. Same queue and no-op-on-missing as
   * remoteUpdateEmbedding.
   */
  async remoteClearEmbedding(projectId: string, key: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        const { error } = await this.timed(this.supabase
          .from('memories')
          .update({ embedding: null })
          .eq('project_id', projectId)
          .eq('key', key))
        if (error) {
          console.error('[tages] Remote embedding clear failed:', error.message)
          return false
        }
        return true
      } catch {
        return false
      }
    })
  }

  /**
   * Narrow, embedding-only remote update keyed by (project_id, key).
   *
   * Routed through the same `enqueue` serialisation queue as remoteInsert's
   * dirty flush and remoteDelete, so the late-resolving embedding write is
   * ordered against concurrent writes and deletes. Crucially this is an
   * `.update()` (not `.upsert()`): it sets ONLY the `embedding` column and
   * is a no-op when no row matches (the key was `forget`-deleted between the
   * original write and now) — it never re-creates a deleted row and never
   * clobbers a newer value written by a concurrent remember(key, V2).
   */
  async remoteUpdateEmbedding(projectId: string, key: string, embedding: number[]): Promise<boolean> {
    return this.enqueue(() => this._remoteUpdateEmbedding(projectId, key, embedding))
  }

  private async _remoteUpdateEmbedding(projectId: string, key: string, embedding: number[]): Promise<boolean> {
    try {
      const { error } = await this.timed(this.supabase
        .from('memories')
        .update({ embedding: embeddingToPgVector(embedding) })
        .eq('project_id', projectId)
        .eq('key', key))
      if (error) {
        console.error('[tages] Remote embedding update failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Replace all remote chunk rows for a memory (delete-then-insert by
   * memory_id, mirroring SqliteCache.upsertChunks's local semantics). Not
   * routed through `enqueue` — it's called either directly from a
   * fire-and-forget embedding job (server write path) or from inside
   * `_flushDirtyChunks`, which already runs inside `enqueue`'s serialized
   * queue via `flush()`.
   *
   * Race guard (Task 9 pre-mortem): this can resolve seconds after the
   * original write (fire-and-forget), or run during a later flush cycle, so
   * the parent memory may have been `forget`-deleted in the meantime.
   * Deleting the old chunk set and blindly re-inserting a fresh one against a
   * `memory_id` that no longer exists would violate the `memory_id` foreign
   * key (loud failure) — or, if that id were ever reused by an unrelated row,
   * would silently attach chunks to the WRONG memory (a much worse, silent
   * failure). So the parent's existence is re-checked immediately before the
   * insert half rather than relied upon via the FK: on a torn-down parent,
   * this returns false (nothing inserted, chunks stay deleted) instead of
   * surfacing an FK error or risking a misattached row.
   *
   * Known limitation, not fixed here (out of this task's file ownership):
   * `remoteInsert` above always excludes `id` from the upsert payload, so a
   * memory's authoritative Supabase row id can differ from the locally
   * generated `memory.id` a caller passes in here — see this task's PR notes.
   * When that happens, the parent-exists check below simply finds no match
   * and this fails open (logged, no chunks written) rather than corrupting
   * data; the caller's pooled-embedding write is entirely unaffected either
   * way.
   */
  async remoteUpsertChunks(
    projectId: string,
    key: string,
    chunks: Array<{ text: string; embedding: number[] }>,
  ): Promise<boolean> {
    try {
      // Keyed on (project_id, key), NOT a memory id: remote memory upserts
      // strip the local id (Supabase keeps/assigns its own), so a locally
      // generated uuid routinely differs from the remote row's real id for
      // every CLI-written memory. Keying the delete/insert on a local id
      // silently no-ops (delete matches nothing, parent check finds
      // nothing), stranding all chunks locally: caught live on the dev
      // eval, 42 local chunk rows / 0 remote. Same id-divergence class as
      // PR #70's embedding-update bug; same fix (resolve via project+key).
      // This resolution doubles as the concurrent-parent-delete race guard.
      const { data: parent, error: parentError } = await this.timed(this.supabase
        .from('memories')
        .select('id')
        .eq('project_id', projectId)
        .eq('key', key)
        .maybeSingle())
      if (parentError) {
        console.error('[tages] Remote chunk parent resolve failed:', parentError.message)
        return false
      }
      if (!parent) {
        console.error(`[tages] Remote chunk sync skipped: parent memory "${key}" not on remote yet (or deleted)`)
        return false
      }
      const remoteMemoryId = (parent as { id: string }).id

      const { error: deleteError } = await this.timed(this.supabase
        .from('memory_chunks')
        .delete()
        .eq('memory_id', remoteMemoryId))
      if (deleteError) {
        console.error('[tages] Remote chunk delete failed:', deleteError.message)
        return false
      }

      if (chunks.length === 0) return true

      const rows = chunks.map((chunk, index) => ({
        memory_id: remoteMemoryId,
        project_id: projectId,
        chunk_index: index,
        chunk_text: chunk.text,
        embedding: embeddingToPgVector(chunk.embedding),
      }))
      const { error: insertError } = await Promise.resolve(
        this.timed(this.supabase.from('memory_chunks').insert(rows)),
      )
      if (insertError) {
        console.error('[tages] Remote chunk insert failed:', insertError.message)
        return false
      }
      return true
    } catch (err) {
      console.error('[tages] Remote chunk upsert error:', (err as Error).message)
      return false
    }
  }

  async remoteDelete(projectId: string, key: string): Promise<boolean> {
    return this.enqueue(() => this._remoteDelete(projectId, key))
  }

  /**
   * true = the row is gone remotely afterwards (deleted now, or never existed).
   * false = error, or zero rows deleted while the row is still visible: RLS
   * refusing a read-only member, which PostgREST reports as success (bug 5).
   */
  private async _remoteDelete(projectId: string, key: string): Promise<boolean> {
    try {
      const { error, count } = await this.timed(this.supabase
        .from('memories')
        .delete({ count: 'exact' })
        .eq('project_id', projectId)
        .eq('key', key))

      if (error) {
        console.error('[tages] Remote delete failed:', error.message)
        return false
      }
      if (count === 0) {
        const visible = await this.remoteKeyVisible(projectId, key)
        if (visible !== false) {
          console.error(`[tages] Remote delete refused: "${key}" still exists (permission denied)`)
          return false
        }
      }
      return true
    } catch {
      return false
    }
  }

  async remoteRecall(
    query: string,
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const { data, error } = await this.supabase.rpc('recall_memories', {
        p_project_id: this.projectId,
        p_query: query,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Remote recall failed:', error.message)
        return null
      }

      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  async remoteHybridRecall(
    query: string,
    embedding: number[],
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const embeddingStr = embeddingToPgVector(embedding)
      const { data, error } = await this.supabase.rpc('hybrid_recall', {
        p_project_id: this.projectId,
        p_query: query,
        p_embedding: embeddingStr,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Hybrid recall failed:', error.message)
        return null
      }

      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  /**
   * Chunk-level semantic recall (PLAN.md Task 11): calls the
   * `chunk_semantic_recall` RPC (migration 0064), which matches against
   * per-chunk embeddings and rolls up to one row per parent memory (its
   * best-matching chunk). Mirrors `remoteHybridRecall`'s shape; the RPC's
   * extra chunk_index/chunk_text columns are dropped by dbRowToMemory —
   * the parent memory's full value is what the MCP tool returns.
   */
  async remoteChunkSemanticRecall(
    embedding: number[],
    type?: string,
    limit = 5,
  ): Promise<Memory[] | null> {
    try {
      const embeddingStr = embeddingToPgVector(embedding)
      const { data, error } = await this.supabase.rpc('chunk_semantic_recall', {
        p_project_id: this.projectId,
        p_embedding: embeddingStr,
        p_type: type || null,
        p_limit: limit,
      })

      if (error) {
        console.error('[tages] Chunk semantic recall failed:', error.message)
        return null
      }

      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  async remoteGetByType(type: string): Promise<Memory[] | null> {
    try {
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('project_id', this.projectId)
        .eq('type', type)
        .eq('status', 'live')
        .order('updated_at', { ascending: false })

      if (error) return null
      return (data || []).map(dbRowToMemory)
    } catch {
      return null
    }
  }

  /**
   * Promote a remote memory to `status='live'`, keyed by (project_id, key).
   *
   * NOT keyed by the memory's local id. `remoteInsert` / `_flushMemories`
   * strip `id` from the upsert payload and conflict on `project_id,key`, so
   * Supabase assigns its own uuid while the local SQLite row keeps the
   * `randomUUID()` it was created with. For every memory written through this
   * client those two ids differ, so `.eq('id', localId)` matched zero rows and
   * this silently no-opped: the remote row stayed `pending`, and since every
   * recall path filters `status='live'`, no teammate ever saw the promotion.
   *
   * Same id-divergence bug class as PR #70's embedding update and the chunk
   * sync bug; same fix — resolve the row by its business key, which is exactly
   * the upsert's conflict target.
   *
   * This is an `.update()`, never an `.upsert()`: a non-matching row is a
   * no-op, so a `forget`-deleted memory is never resurrected.
   *
   * Returns false on error, and when the update changed zero rows although a
   * row with that key is visible: that is RLS refusing a read-only member
   * (bug 5), which PostgREST reports as success with no rows. A key with no
   * visible remote row also returns false: nothing in the shared store was
   * verified. Callers push an unsynced row first (handleVerifyMemory does).
   */
  async remoteVerifyMemory(projectId: string, key: string, verifiedAt: string): Promise<boolean> {
    try {
      const { error, count } = await this.supabase
        .from('memories')
        .update({ status: 'live', verified_at: verifiedAt }, { count: 'exact' })
        .eq('project_id', projectId)
        .eq('key', key)
      if (error) {
        console.error('[tages] Remote verify failed:', error.message)
        return false
      }
      if (count === 0) {
        const visible = await this.remoteKeyVisible(projectId, key)
        console.error(visible === false
          ? `[tages] Remote verify failed: "${key}" is not in the shared store`
          : `[tages] Remote verify refused: "${key}" exists but 0 rows were updated (permission denied)`)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * true/false = whether a row with this key is visible to the caller;
   * null = the probe itself failed (callers treat that as "cannot confirm").
   */
  private async remoteKeyVisible(projectId: string, key: string): Promise<boolean | null> {
    try {
      const { count, error } = await this.timed(this.supabase
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('key', key))
      if (error || typeof count !== 'number') return null
      return count > 0
    } catch {
      return null
    }
  }

  /**
   * Fetch full rows for specific keys, in batches of KEY_BATCH. Map key is
   * `memory.key`; values are exactly what dbRowToMemory returns (encrypted
   * values stay encrypted). Null on any error, so a caller never mistakes a
   * failed lookup for "no such key".
   */
  async remoteGetByKeys(projectId: string, keys: string[]): Promise<Map<string, Memory> | null> {
    const out = new Map<string, Memory>()
    const unique = [...new Set(keys)]
    try {
      for (let i = 0; i < unique.length; i += KEY_BATCH) {
        const batch = unique.slice(i, i + KEY_BATCH)
        const { data, error } = await this.timed(
          this.supabase
            .from('memories')
            .select('*')
            .eq('project_id', projectId)
            .in('key', batch),
        )
        if (error) {
          console.error('[tages] Remote get-by-keys failed:', error.message)
          return null
        }
        for (const row of (data || []) as DbRow[]) {
          const memory = dbRowToMemory(row)
          out.set(memory.key, memory)
        }
      }
      return out
    } catch (err) {
      console.error('[tages] Remote get-by-keys error:', (err as Error).message)
      return null
    }
  }

  /** Persist a federated memory promotion to Supabase. */
  async remoteFederatedInsert(row: {
    id: string
    owner_project_id: string
    memory_key: string
    memory_data: unknown
    scope: string
    version: number
    promoted_by: string | null
    promoted_at: string
  }): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('federated_memories')
        .upsert(row, { onConflict: 'memory_key,version' })
      if (error) {
        console.error('[tages] Federated insert failed:', error.message)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  /** List federated memories from Supabase, optionally filtered by scope. */
  async remoteListFederated(scope?: string): Promise<Array<{
    id: string
    owner_project_id: string
    memory_key: string
    memory_data: unknown
    scope: string
    version: number
    promoted_by: string | null
    promoted_at: string
  }> | null> {
    try {
      let query = this.supabase.from('federated_memories').select('*')
      if (scope) {
        query = query.eq('scope', scope)
      }
      const { data, error } = await query.order('promoted_at', { ascending: false })
      if (error) {
        console.error('[tages] Federated list failed:', error.message)
        return null
      }
      return data || []
    } catch {
      return null
    }
  }
}

interface DbRow {
  id: string
  project_id: string
  key: string
  value: string
  type: string
  source: string
  status: string
  agent_name: string | null
  file_paths: string[]
  tags: string[]
  confidence: number
  conditions: string[] | null
  phases: string[] | null
  cross_system_refs: string[] | null
  examples: unknown | null
  execution_flow: unknown | null
  verified_at: string | null
  referenced_date: string | null
  relative_date: string | null
  evidence: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  encrypted: boolean
  // Optional (not `| null`) and deliberately omitted from the row object when
  // the in-memory Memory has no embedding yet: Supabase's `.upsert()` only
  // updates columns present in the payload, so omitting the key on a
  // conflict-update leaves any already-synced embedding untouched instead of
  // clobbering it with null. See memoryToDbRow below.
  embedding?: string
}

/**
 * Max of server timestamps, compared by instant. Ties at millisecond
 * precision keep the lexically larger string, which preserves Postgres
 * microseconds (same offset format from the same server): truncating to ms
 * would make `updated_at > watermark` re-match the newest row forever.
 */
export function maxTimestamp(current: string | null, candidates: string[]): string | null {
  let best = current
  for (const c of candidates) {
    if (!c) continue
    if (best === null) { best = c; continue }
    const a = Date.parse(c)
    const b = Date.parse(best)
    if (Number.isNaN(a)) continue
    if (Number.isNaN(b) || a > b || (a === b && c > best)) best = c
  }
  return best
}

/** `ts` moved by `deltaMs`, as ISO (sub-ms precision is dropped: callers use it as a loose bound). */
function shiftTimestamp(ts: string, deltaMs: number): string {
  const t = Date.parse(ts)
  return Number.isNaN(t) ? ts : new Date(t + deltaMs).toISOString()
}

/** PostgREST `in` list literal: every value double-quoted, with `\` and `"` escaped. */
export function pgInList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`
}

const TIMED_OUT = Symbol('timed-out')

/** Resolve with `p`, or TIMED_OUT after `ms`. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Same instant at ms precision, tolerant of 'Z' vs '+00:00' formatting. */
function sameInstant(a: string, b: string): boolean {
  if (a === b) return true
  const x = Date.parse(a)
  const y = Date.parse(b)
  return !Number.isNaN(x) && x === y
}

/** Serialize a raw embedding vector into the pgvector literal format Supabase expects. */
export function embeddingToPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/** Parse a pgvector literal (or Supabase's string representation of one) back into a number array. */
export function pgVectorToEmbedding(value: string): number[] {
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!trimmed) return []
  return trimmed.split(',').map(Number)
}

export function dbRowToMemory(row: DbRow): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    value: row.value,
    type: row.type as Memory['type'],
    source: row.source as Memory['source'],
    status: (row.status || 'live') as Memory['status'],
    agentName: row.agent_name || undefined,
    filePaths: row.file_paths || [],
    tags: row.tags || [],
    confidence: row.confidence,
    conditions: row.conditions || undefined,
    phases: row.phases || undefined,
    crossSystemRefs: row.cross_system_refs || undefined,
    examples: row.examples as Memory['examples'],
    executionFlow: row.execution_flow as Memory['executionFlow'],
    verifiedAt: row.verified_at || undefined,
    referencedDate: row.referenced_date || undefined,
    relativeDate: row.relative_date || undefined,
    evidence: (row.evidence as Memory['evidence']) || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || undefined,
    updatedBy: row.updated_by || undefined,
    encrypted: row.encrypted || false,
    embedding: row.embedding ? pgVectorToEmbedding(row.embedding) : undefined,
  }
}

export function memoryToDbRow(memory: Memory): DbRow {
  const row: DbRow = {
    id: memory.id,
    project_id: memory.projectId,
    key: memory.key,
    value: memory.value,
    type: memory.type,
    source: memory.source,
    status: memory.status || 'live',
    agent_name: memory.agentName || null,
    file_paths: memory.filePaths || [],
    tags: memory.tags || [],
    confidence: memory.confidence,
    conditions: memory.conditions || null,
    phases: memory.phases || null,
    cross_system_refs: memory.crossSystemRefs || null,
    examples: memory.examples || null,
    execution_flow: memory.executionFlow || null,
    verified_at: memory.verifiedAt || null,
    referenced_date: memory.referencedDate || null,
    relative_date: memory.relativeDate || null,
    // NULL, not a default: an unassessed claim must not acquire an evidence
    // level on its way to the cloud (migration 0070).
    evidence: memory.evidence || null,
    created_at: memory.createdAt,
    updated_at: memory.updatedAt,
    created_by: memory.createdBy || null,
    updated_by: memory.updatedBy || null,
    encrypted: memory.encrypted || false,
  }
  // Only set the column when we actually have an embedding. Leaving the key
  // off entirely (rather than setting it to null) means a sync that races
  // ahead of embedding generation can't stomp a previously-computed embedding.
  if (memory.embedding && memory.embedding.length > 0) {
    row.embedding = embeddingToPgVector(memory.embedding)
  }
  return row
}
