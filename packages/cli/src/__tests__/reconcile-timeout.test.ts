import { describe, it, expect, afterEach } from 'vitest'
import { withTimeout, TIMED_OUT, reconcileTimeoutMs } from '../sync/auto-reconcile.js'

describe('withTimeout', () => {
  const saved = process.env.TAGES_SYNC_TIMEOUT_MS
  afterEach(() => {
    if (saved === undefined) delete process.env.TAGES_SYNC_TIMEOUT_MS
    else process.env.TAGES_SYNC_TIMEOUT_MS = saved
  })

  it('returns the result when the work finishes inside the ceiling', async () => {
    const out = await withTimeout(async () => 'done', 1_000)
    expect(out).toBe('done')
  })

  it('gives up on work that never settles, instead of hanging', async () => {
    // The regression this guards: the reconcile runs from a preAction hook in
    // front of nearly every command, and none of its network calls carry an
    // AbortSignal. A socket that accepts the connection and then never answers
    // used to fall through to undici's 300s default.
    const start = Date.now()
    const out = await withTimeout(() => new Promise<string>(() => {}), 50)
    expect(out).toBe(TIMED_OUT)
    expect(Date.now() - start).toBeLessThan(2_000)
  })

  it('does not raise an unhandled rejection when abandoned work rejects later', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (r: unknown) => unhandled.push(r)
    process.on('unhandledRejection', onUnhandled)
    try {
      const out = await withTimeout(
        () => new Promise<string>((_, reject) => setTimeout(() => reject(new Error('late failure')), 30)),
        5,
      )
      expect(out).toBe(TIMED_OUT)
      // Let the abandoned promise reject and the microtask queue drain.
      await new Promise(r => setTimeout(r, 120))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('propagates a genuine error rather than disguising it as a timeout', async () => {
    await expect(
      withTimeout(async () => {
        throw new Error('auth expired')
      }, 1_000),
    ).rejects.toThrow('auth expired')
  })

  it('treats an empty TAGES_SYNC_TIMEOUT_MS as unset, not as zero', async () => {
    // Number('') is 0, and a 0ms ceiling would time out every reconcile
    // instantly and silently.
    process.env.TAGES_SYNC_TIMEOUT_MS = '   '
    expect(reconcileTimeoutMs()).toBe(3_000)
    process.env.TAGES_SYNC_TIMEOUT_MS = '0'
    expect(reconcileTimeoutMs()).toBe(3_000)
    process.env.TAGES_SYNC_TIMEOUT_MS = '500'
    expect(reconcileTimeoutMs()).toBe(500)
  })
})
