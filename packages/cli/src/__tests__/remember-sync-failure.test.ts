import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
} from './helpers.js'

// Regression guard for the silent-cloud-failure bug: `tages remember` printed
// a green "Stored:" unconditionally, so a memory that never left local SQLite
// (dirty=1, invisible to every teammate) looked identical to one that synced.
//
// Mocking conventions follow remember.test.ts: vi.hoisted() shares the mock
// fns between the hoisted vi.mock factory and the test bodies.
const {
  mockUpsertMemory,
  mockUpsertMemoryWithEmbedding,
  mockUpsertChunks,
  mockGetByKey,
  mockFlush,
  mockFlushWithResult,
  mockClose,
  mockOpenCliSync,
  mockGenerateEmbedding,
  mockGenerateChunkEmbeddings,
  mockCreateAuthenticatedClient,
} = vi.hoisted(() => {
  const mockUpsertMemory = vi.fn()
  const mockUpsertMemoryWithEmbedding = vi.fn()
  const mockUpsertChunks = vi.fn()
  const mockGetByKey = vi.fn().mockReturnValue(null)
  const mockFlush = vi.fn().mockResolvedValue(undefined)
  const mockFlushWithResult = vi.fn().mockResolvedValue({ ok: true })
  const mockClose = vi.fn()
  const mockOpenCliSync = vi.fn()
  const mockGenerateEmbedding = vi.fn().mockResolvedValue(null)
  const mockGenerateChunkEmbeddings = vi.fn().mockResolvedValue(null)
  const mockCreateAuthenticatedClient = vi.fn()
  return {
    mockUpsertMemory,
    mockUpsertMemoryWithEmbedding,
    mockUpsertChunks,
    mockGetByKey,
    mockFlush,
    mockFlushWithResult,
    mockClose,
    mockOpenCliSync,
    mockGenerateEmbedding,
    mockGenerateChunkEmbeddings,
    mockCreateAuthenticatedClient,
  }
})

vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: mockOpenCliSync,
}))

vi.mock('../lib/embedding.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
  generateChunkEmbeddings: mockGenerateChunkEmbeddings,
}))

// Only used by the integration block at the bottom, which loads the REAL
// cli-sync module. remember.ts never imports this.
// cli-sync reads the session status itself (0.5.7) so a dead session stays
// local instead of exiting. `mockSessionStatus.value` drives that status.
const mockSessionStatus = vi.hoisted(() => ({ value: 'authenticated' as string }))
vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mockCreateAuthenticatedClient,
  createAuthenticatedClientWithStatus: async (...args: unknown[]) => ({
    supabase: await mockCreateAuthenticatedClient(...args),
    status: mockSessionStatus.value,
  }),
}))

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import { rememberCommand } from '../commands/remember.js'

/** Everything remember() printed, both streams, as one blob. */
function allOutput(console_: ReturnType<typeof captureConsole>): string {
  return [...console_.logs, ...console_.errors].join('\n')
}

describe('remember command — cloud sync failure reporting', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    mockFlush.mockResolvedValue(undefined)
    mockFlushWithResult.mockResolvedValue({ ok: true })
    mockGenerateEmbedding.mockResolvedValue(null)
    mockGenerateChunkEmbeddings.mockResolvedValue(null)
    mockGetByKey.mockReturnValue(null)
    mockOpenCliSync.mockResolvedValue({
      cache: {
        upsertMemory: mockUpsertMemory,
        upsertMemoryWithEmbedding: mockUpsertMemoryWithEmbedding,
        upsertChunks: mockUpsertChunks,
        getByKey: mockGetByKey,
      },
      flush: mockFlush,
      flushWithResult: mockFlushWithResult,
      close: mockClose,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('does NOT print the green success line when the cloud write fails', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlushWithResult.mockResolvedValue({
      ok: false,
      error: 'new row violates row-level security policy for table "memories"',
    })

    await rememberCommand('rls-key', 'rls value', { type: 'convention' })

    const output = allOutput(console_)
    expect(output).not.toContain('Stored:')
    expect(output).toContain('Stored locally only:')
    expect(output).toContain('Cloud sync failed:')
    // The underlying reason must survive to the developer, not be swallowed.
    expect(output).toContain('new row violates row-level security policy for table "memories"')
    expect(output).toContain('Teammates will not see this memory')
    expect(output).toContain('rls-key')
  })

  it('still writes the memory locally when the cloud write fails', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlushWithResult.mockResolvedValue({ ok: false, error: 'network unreachable' })

    await rememberCommand('offline-key', 'offline value', { type: 'convention' })

    // Local durability is unchanged — the row stays dirty for a later sync.
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'offline-key', value: 'offline value' }),
      true,
    )
    expect(mockClose).toHaveBeenCalled()
  })

  it('reports a failure even when flushWithResult gives no error text', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlushWithResult.mockResolvedValue({ ok: false })

    await rememberCommand('bare-key', 'bare value', { type: 'convention' })

    const output = allOutput(console_)
    expect(output).not.toContain('Stored:')
    expect(output).toContain('Stored locally only:')
    expect(output).toContain('unknown error')
  })

  it('prints the normal green success line when the cloud write succeeds', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlushWithResult.mockResolvedValue({ ok: true })

    await rememberCommand('good-key', 'good value', { type: 'convention' })

    expect(console_.logs.join('\n')).toContain('Stored:')
    expect(console_.logs.join('\n')).toContain('good-key')
    expect(console_.logs.join('\n')).toContain('convention')
    expect(allOutput(console_)).not.toContain('Cloud sync failed:')
    expect(allOutput(console_)).not.toContain('Stored locally only:')
  })

  it('treats a context without flushWithResult as success (legacy/mocked contexts)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    // A sync context predating outcome reporting: only the void-returning flush.
    mockOpenCliSync.mockResolvedValue({
      cache: {
        upsertMemory: mockUpsertMemory,
        upsertMemoryWithEmbedding: mockUpsertMemoryWithEmbedding,
        upsertChunks: mockUpsertChunks,
        getByKey: mockGetByKey,
      },
      flush: mockFlush,
      close: mockClose,
    })

    await rememberCommand('legacy-key', 'legacy value', { type: 'convention' })

    expect(mockFlush).toHaveBeenCalled()
    expect(console_.logs.join('\n')).toContain('Stored:')
    expect(allOutput(console_)).not.toContain('Cloud sync failed:')
  })
})

/**
 * Integration: the REAL openCliSync closure, a REAL SqliteCache in a temp dir,
 * and the REAL SupabaseSync, driven by a fake Supabase client.
 *
 * This is the load-bearing case. SupabaseSync._flushMemories() catches the
 * Supabase error, logs it, and returns normally, so `await sync.flush()`
 * resolving proves nothing about whether the write landed. The only honest
 * signal is that markSynced() never ran and the rows are still dirty.
 */
describe('openCliSync flushWithResult against a real cache + real SupabaseSync', () => {
  const CLOUD_CONFIG = {
    projectId: 'sync-failure-project',
    supabaseUrl: 'https://fake.supabase.co',
    supabaseAnonKey: 'fake-anon-key',
  }

  function makeMemory(key: string) {
    const now = new Date().toISOString()
    return {
      id: `id-${key}`,
      projectId: CLOUD_CONFIG.projectId,
      key,
      value: `${key} value`,
      type: 'convention',
      source: 'manual',
      filePaths: [],
      tags: [],
      status: 'live',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    }
  }

  /** Minimal Supabase double: _flushMemories only needs from().upsert(). */
  function fakeSupabase(upsertError: { message: string } | null) {
    return {
      from: () => ({
        upsert: async () => ({ data: null, error: upsertError }),
      }),
    }
  }

  async function realOpenCliSync() {
    const actual = await vi.importActual<typeof import('../sync/cli-sync.js')>(
      '../sync/cli-sync.js',
    )
    return actual.openCliSync
  }

  let setup: ReturnType<typeof setupTempConfigDir>
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    setup = setupTempConfigDir()
    // cli-sync resolves its DB path through the mocked paths module.
    tempConfigDir = setup.configDir
    console_ = captureConsole()
    vi.clearAllMocks()
  })

  afterEach(() => {
    console_.restore()
    setup.cleanup()
  })

  it('reports ok:false and the Supabase error when the remote upsert fails', async () => {
    mockCreateAuthenticatedClient.mockResolvedValue(
      fakeSupabase({ message: 'new row violates row-level security policy for table "memories"' }),
    )
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `fail-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('rls-blocked'), true)
      const result = await ctx.flushWithResult()

      expect(result.ok).toBe(false)
      expect(result.error).toContain('row-level security policy')
      // The row is still dirty — it never left this machine.
      expect(ctx.cache.getDirty()).toHaveLength(1)
    } finally {
      ctx.close()
    }
  })

  it('reports ok:true once the rows actually land', async () => {
    mockCreateAuthenticatedClient.mockResolvedValue(fakeSupabase(null))
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `ok-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('synced-fine'), true)
      const result = await ctx.flushWithResult()

      expect(result).toEqual({ ok: true })
      expect(ctx.cache.getDirty()).toHaveLength(0)
    } finally {
      ctx.close()
    }
  })

  it('reports ok:false when cloud sync was configured but the client could not be built', async () => {
    mockCreateAuthenticatedClient.mockRejectedValue(new Error('no auth token — run `tages login`'))
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `noauth-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('unauthenticated'), true)
      const result = await ctx.flushWithResult()

      expect(result.ok).toBe(false)
      expect(result.error).toContain('no auth token')
    } finally {
      ctx.close()
    }
  })

  it('a dead session keeps the write local and dirty, reports ok:false, never exits', async () => {
    mockCreateAuthenticatedClient.mockResolvedValue(fakeSupabase(null))
    mockSessionStatus.value = 'expired'
    const exitSpy = vi.spyOn(process, 'exit')
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `expired-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('written-while-expired'), true)
      const result = await ctx.flushWithResult()

      expect(exitSpy).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('tages login')
      // still dirty: it pushes after the user logs in
      expect(ctx.cache.getDirty().map((m: { key: string }) => m.key)).toContain('written-while-expired')
    } finally {
      mockSessionStatus.value = 'authenticated'
      exitSpy.mockRestore()
      ctx.close()
    }
  })

  it('an anonymous (signed-out) session also stays local, never builds a sync, never exits', async () => {
    const supabase = fakeSupabase(null)
    const fromSpy = vi.spyOn(supabase, 'from')
    mockCreateAuthenticatedClient.mockResolvedValue(supabase)
    mockSessionStatus.value = 'anonymous'
    const exitSpy = vi.spyOn(process, 'exit')
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `anon-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('written-signed-out'), true)
      const result = await ctx.flushWithResult()

      expect(exitSpy).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not signed in')
      expect(fromSpy).not.toHaveBeenCalled()
      expect(ctx.cache.getDirty().map((m: { key: string }) => m.key)).toContain('written-signed-out')
    } finally {
      mockSessionStatus.value = 'authenticated'
      exitSpy.mockRestore()
      ctx.close()
    }
  })

  it('reconcile on a dead session reports unpushed, pulls nothing, touches no network, does not throw', async () => {
    const supabase = fakeSupabase(null)
    const fromSpy = vi.spyOn(supabase, 'from')
    mockCreateAuthenticatedClient.mockResolvedValue(supabase)
    mockSessionStatus.value = 'expired'
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `recon-expired-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('kept-local'), true)
      const r = await ctx.reconcile()
      expect(r.pushed).toBe(false)
      expect(r.pulled).toBe(0)
      expect(r.alreadyReported).toBe(true)
      expect(r.error).toContain('expired')
      expect(fromSpy).not.toHaveBeenCalled()
      expect(ctx.cache.getDirty()).toHaveLength(1)
    } finally {
      mockSessionStatus.value = 'authenticated'
      ctx.close()
    }
  })

  it('reconcile pushes a failing dirty set once, not twice (hydrate skips its own flush)', async () => {
    let upserts = 0
    const supabase = {
      from: () => ({
        upsert: async () => {
          upserts++
          return { data: null, error: { message: 'new row violates row-level security policy' } }
        },
      }),
    }
    mockCreateAuthenticatedClient.mockResolvedValue(supabase)
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ ...CLOUD_CONFIG, slug: `recon-once-${Date.now()}` })

    try {
      ctx.cache.upsertMemory(makeMemory('stuck'), true)
      const r = await ctx.reconcile()
      expect(r.pushed).toBe(false)
      expect(upserts).toBe(1)
    } finally {
      ctx.close()
    }
  })

  it('local mode (no supabaseUrl) still reports success — nothing was lost', async () => {
    const openCliSync = await realOpenCliSync()
    const ctx = await openCliSync({ projectId: 'local-project', slug: `local-${Date.now()}` })

    try {
      expect(await ctx.flushWithResult()).toEqual({ ok: true })
    } finally {
      ctx.close()
    }
  })
})
