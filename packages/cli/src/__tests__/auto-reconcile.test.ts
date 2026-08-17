import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  isStale,
  shouldSkipReconcile,
  reconcileTtlMs,
  RECONCILE_TTL_MS,
  lastAttemptAt,
  recordAttempt,
} from '../sync/auto-reconcile.js'

const ORIGINAL_TTL_ENV = process.env.TAGES_SYNC_TTL_MS

afterEach(() => {
  if (ORIGINAL_TTL_ENV === undefined) delete process.env.TAGES_SYNC_TTL_MS
  else process.env.TAGES_SYNC_TTL_MS = ORIGINAL_TTL_ENV
})

describe('isStale', () => {
  const now = Date.parse('2026-08-17T12:00:00.000Z')

  it('treats a never-synced cache as stale', () => {
    expect(isStale(null, now, 60_000)).toBe(true)
  })

  it('treats an unparseable timestamp as stale rather than trusting it', () => {
    // A corrupt sync_meta row must not pin the cache as fresh forever.
    expect(isStale('not-a-date', now, 60_000)).toBe(true)
  })

  it('is fresh inside the window', () => {
    expect(isStale('2026-08-17T11:59:30.000Z', now, 60_000)).toBe(false)
  })

  it('is stale at exactly the window boundary', () => {
    expect(isStale('2026-08-17T11:59:00.000Z', now, 60_000)).toBe(true)
  })

  it('is stale well outside the window', () => {
    expect(isStale('2026-08-17T11:00:00.000Z', now, 60_000)).toBe(true)
  })

  it('a zero TTL forces every invocation to reconcile', () => {
    // What the end-to-end suite relies on to test the pull itself rather than
    // the rate limiter.
    expect(isStale('2026-08-17T12:00:00.000Z', now, 0)).toBe(true)
  })
})

describe('reconcileTtlMs', () => {
  it('defaults to the 60s window', () => {
    delete process.env.TAGES_SYNC_TTL_MS
    expect(reconcileTtlMs()).toBe(RECONCILE_TTL_MS)
  })

  it('honours an explicit override, including zero', () => {
    process.env.TAGES_SYNC_TTL_MS = '0'
    expect(reconcileTtlMs()).toBe(0)
    process.env.TAGES_SYNC_TTL_MS = '5000'
    expect(reconcileTtlMs()).toBe(5000)
  })

  it('falls back to the default for garbage or negative values', () => {
    // A typo'd env var must not disable rate limiting silently.
    for (const bad of ['abc', '-1', '', 'NaN']) {
      process.env.TAGES_SYNC_TTL_MS = bad
      expect(reconcileTtlMs()).toBe(RECONCILE_TTL_MS)
    }
  })
})

describe('shouldSkipReconcile', () => {
  it('skips commands that run before a project config exists', () => {
    // Reconciling here would fail noisily, or worse, act on the wrong project.
    for (const cmd of ['init', 'link']) expect(shouldSkipReconcile(cmd)).toBe(true)
  })

  it('skips commands that change or report identity', () => {
    for (const cmd of ['login', 'logout', 'whoami']) expect(shouldSkipReconcile(cmd)).toBe(true)
  })

  it('skips doctor, which must observe state rather than repair it', () => {
    // A doctor that silently fixes the thing it is diagnosing hides the bug.
    expect(shouldSkipReconcile('doctor')).toBe(true)
  })

  it('skips an unknown/absent command name', () => {
    expect(shouldSkipReconcile(undefined)).toBe(true)
  })

  it('reconciles for the commands that actually read or write memories', () => {
    for (const cmd of ['recall', 'remember', 'status', 'forget', 'pending', 'brief']) {
      expect(shouldSkipReconcile(cmd)).toBe(false)
    }
  })
})

/**
 * The rate limiter must key off the last ATTEMPT, not the cache's
 * `last_synced_at`. `SupabaseSync.hydrate()` leaves that timestamp untouched
 * whenever it pulls nothing, so on a quiet project it never advances — and a
 * limiter reading it would let every command through, putting a flush plus two
 * count queries in front of every invocation forever.
 */
describe('reconcile attempt marker', () => {
  let home: string
  const ORIGINAL_HOME = process.env.HOME

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-attempt-'))
    process.env.HOME = home
  })

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('reports no prior attempt before one is recorded', () => {
    expect(lastAttemptAt('proj-1')).toBeNull()
  })

  it('records an attempt even when nothing was pulled', () => {
    recordAttempt('proj-1')
    const at = lastAttemptAt('proj-1')
    expect(at).not.toBeNull()
    expect(Math.abs(Date.now() - (at as number))).toBeLessThan(5000)
  })

  it('tracks attempts per project, so one project cannot suppress another', () => {
    recordAttempt('proj-1')
    expect(lastAttemptAt('proj-1')).not.toBeNull()
    expect(lastAttemptAt('proj-2')).toBeNull()
  })

  it('an unwritable marker directory degrades to "no attempt" rather than throwing', () => {
    // Costs an extra round trip; must never break the command.
    process.env.HOME = '/nonexistent/path/that/cannot/be/created'
    expect(() => recordAttempt('proj-1')).not.toThrow()
    expect(lastAttemptAt('proj-1')).toBeNull()
  })
})
