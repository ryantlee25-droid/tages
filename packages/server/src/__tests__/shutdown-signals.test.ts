import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'

/**
 * Shutdown-signal regression tests.
 *
 * The defect: only SIGINT was handled. MCP clients terminate stdio servers with
 * SIGTERM, whose default action is immediate death — so a session ending shortly
 * after a write never reached `sync.flush()`, silently dropping the pooled
 * embedding and chunk writes while the memory row itself survived. The memory
 * stayed findable by trigram and invisible to semantic search.
 */

// Must be set before the dynamic import below: importing the entrypoint would
// otherwise call main(), opening SQLite and claiming stdio inside the test run.
process.env.TAGES_NO_AUTOSTART = '1'

let mod: typeof import('../index')

beforeAll(async () => {
  // `.js` extension required by moduleResolution node16 for dynamic imports;
  // Vite resolves it back to the TypeScript source.
  mod = await import('../index.js')
})

/** Records every effect the shutdown routine is supposed to perform, once. */
function makeDeps(overrides: Partial<{
  flush: () => Promise<void>
  endSession: () => Promise<void>
}> = {}) {
  const calls = { endSession: 0, flush: 0, stopSync: 0, close: 0, exit: [] as number[] }
  const deps = {
    tracker: {
      endSession: async () => {
        calls.endSession++
        if (overrides.endSession) await overrides.endSession()
      },
    },
    sync: {
      flush: async () => {
        calls.flush++
        if (overrides.flush) await overrides.flush()
      },
      stopSync: () => { calls.stopSync++ },
    },
    cache: { close: () => { calls.close++ } },
    exit: (code: number) => { calls.exit.push(code) },
  }
  return { calls, deps }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerShutdownHandlers', () => {
  it('registers the shutdown routine for SIGTERM as well as SIGINT', () => {
    const spy = vi.spyOn(process, 'on').mockReturnValue(process)
    const shutdown = vi.fn(async () => {})

    mod.registerShutdownHandlers(shutdown)

    const signals = spy.mock.calls.map(([event]) => event)
    expect(signals).toContain('SIGINT')
    expect(signals).toContain('SIGTERM')
  })

  it('also covers a silent event-loop drain via beforeExit', () => {
    const spy = vi.spyOn(process, 'on').mockReturnValue(process)

    mod.registerShutdownHandlers(vi.fn(async () => {}))

    expect(spy.mock.calls.map(([event]) => event)).toContain('beforeExit')
  })

  it('attaches real listeners that invoke the shutdown routine on SIGTERM', () => {
    const before = process.listeners('SIGTERM').length
    const shutdown = vi.fn(async () => {})

    mod.registerShutdownHandlers(shutdown)
    try {
      const listeners = process.listeners('SIGTERM')
      expect(listeners.length).toBe(before + 1)

      // Invoke the newly attached listener directly rather than raising a real
      // signal, which would terminate the test runner.
      ;(listeners[listeners.length - 1] as (...args: unknown[]) => void)('SIGTERM')
      expect(shutdown).toHaveBeenCalledTimes(1)
      expect(shutdown).toHaveBeenCalledWith(0)
    } finally {
      // Do not leak listeners into sibling test files.
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        const added = process.listeners(signal).slice(before)
        for (const l of added) process.removeListener(signal, l as never)
      }
      const beforeExitAdded = process.listeners('beforeExit').slice(-1)
      for (const l of beforeExitAdded) process.removeListener('beforeExit', l as never)
    }
  })
})

describe('createShutdown', () => {
  it('performs the full cleanup sequence and preserves the exit code', async () => {
    const { calls, deps } = makeDeps()
    const timer = setInterval(() => {}, 60_000)

    await mod.createShutdown({ ...deps, decayTimer: timer, timeoutMs: 1_000 })(0)

    expect(calls).toMatchObject({ endSession: 1, flush: 1, stopSync: 1, close: 1 })
    expect(calls.exit).toEqual([0])
    clearInterval(timer)
  })

  it('runs its work exactly once when invoked twice in sequence', async () => {
    const { calls, deps } = makeDeps()
    const shutdown = mod.createShutdown({ ...deps, timeoutMs: 1_000 })

    await shutdown(0)
    await shutdown(0)

    expect(calls).toMatchObject({ endSession: 1, flush: 1, stopSync: 1, close: 1 })
    expect(calls.exit).toEqual([0])
  })

  it('does not re-enter when a second signal arrives mid-shutdown', async () => {
    let releaseFlush: () => void = () => {}
    const gate = new Promise<void>((resolve) => { releaseFlush = resolve })
    const { calls, deps } = makeDeps({ flush: () => gate })
    const shutdown = mod.createShutdown({ ...deps, timeoutMs: 1_000 })

    // Two signals landing together — the second must join the first, not start
    // a second drain that interleaves with it.
    const first = shutdown(0)
    const second = shutdown(0)
    expect(second).toBe(first)

    releaseFlush()
    await Promise.all([first, second])

    expect(calls).toMatchObject({ endSession: 1, flush: 1, stopSync: 1, close: 1 })
    expect(calls.exit).toEqual([0])
  })

  it('resolves and exits anyway when the flush never settles', async () => {
    // A flush that never settles: without a bound this hangs the process, which
    // is worse than losing the embedding.
    const { calls, deps } = makeDeps({ flush: () => new Promise<void>(() => {}) })
    const shutdown = mod.createShutdown({ ...deps, timeoutMs: 20 })

    await expect(shutdown(0)).resolves.toBeUndefined()

    expect(calls.flush).toBe(1)
    expect(calls.close).toBe(1)
    expect(calls.exit).toEqual([0])
  })

  it('still closes the cache and exits when the drain rejects', async () => {
    const { calls, deps } = makeDeps({ flush: async () => { throw new Error('supabase unreachable') } })

    await expect(mod.createShutdown({ ...deps, timeoutMs: 1_000 })(0)).resolves.toBeUndefined()

    expect(calls.close).toBe(1)
    expect(calls.exit).toEqual([0])
  })

  it('does not raise an unhandled rejection when the flush rejects after the timeout wins', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => { rejections.push(reason) }
    process.on('unhandledRejection', onRejection)
    try {
      // Rejects well after the 10ms deadline, so the race is already lost and
      // nothing is left awaiting the drain.
      const { deps } = makeDeps({
        flush: () => new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('late failure')), 40)),
      })

      await mod.createShutdown({ ...deps, timeoutMs: 10 })(0)
      await new Promise((resolve) => setTimeout(resolve, 120))

      expect(rejections).toEqual([])
    } finally {
      process.removeListener('unhandledRejection', onRejection)
    }
  })

  it('tolerates a local-only server with no sync configured', async () => {
    const calls = { close: 0, exit: [] as number[] }

    await mod.createShutdown({
      tracker: null,
      sync: null,
      cache: { close: () => { calls.close++ } },
      exit: (code: number) => { calls.exit.push(code) },
      timeoutMs: 1_000,
    })(0)

    expect(calls.close).toBe(1)
    expect(calls.exit).toEqual([0])
  })

  it('clears the decay timer so it cannot fire against a closed cache', async () => {
    const timer = setInterval(() => {}, 60_000)
    const clearSpy = vi.spyOn(global, 'clearInterval')
    const { deps } = makeDeps()

    await mod.createShutdown({ ...deps, decayTimer: timer, timeoutMs: 1_000 })(0)

    expect(clearSpy).toHaveBeenCalledWith(timer)
    clearInterval(timer)
  })

  it('defaults the drain timeout to a bound shorter than a typical SIGKILL grace period', () => {
    expect(mod.SHUTDOWN_DRAIN_TIMEOUT_MS).toBeGreaterThan(0)
    expect(mod.SHUTDOWN_DRAIN_TIMEOUT_MS).toBeLessThanOrEqual(10_000)
  })
})
