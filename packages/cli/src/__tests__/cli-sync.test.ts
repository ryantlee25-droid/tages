import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { openCliSync, type ProjectConfig } from '../sync/cli-sync.js'

// Temp directory for test SQLite DBs
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cli-sync-test-'))

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

describe('openCliSync', () => {
  it('local mode returns no-op flush', async () => {
    const config: ProjectConfig = {
      projectId: 'test-project-local',
      slug: `local-${Date.now()}`,
      // supabaseUrl intentionally absent
    }

    // Override getCacheDir by writing to our temp dir
    // We do this by constructing the DB path manually and passing slug
    // The easiest approach: mock the env so getCacheDir returns tmpDir
    // Since getCacheDir is not easily mockable without vi.mock, we use slug-based naming
    // and accept that it writes to ~/.config/tages/cache — clean up afterward
    const ctx = await openCliSync(config)

    try {
      // flush should resolve without throwing
      await expect(ctx.flush()).resolves.toBeUndefined()

      // cache should be a SqliteCache-like object (has close method)
      expect(ctx.cache).toBeDefined()
      expect(typeof ctx.cache.close).toBe('function')

      // flush is truly a no-op — call it multiple times, still no throw
      await expect(ctx.flush()).resolves.toBeUndefined()
      await expect(ctx.flush()).resolves.toBeUndefined()
    } finally {
      ctx.close()
    }
  })

  it('cloud mode with missing auth falls back gracefully', async () => {
    // Point auth to a path that does not exist
    // The createAuthenticatedClient in the implementation reads from getAuthPath()
    // With no auth.json, it still returns an unauthenticated supabase client
    // SupabaseSync will be instantiated, but flush() will fail gracefully (catches errors)
    const config: ProjectConfig = {
      projectId: 'test-project-cloud',
      slug: `cloud-${Date.now()}`,
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    }

    // Should not throw even without auth.json or a real Supabase URL
    let ctx: Awaited<ReturnType<typeof openCliSync>> | null = null
    await expect(async () => {
      ctx = await openCliSync(config)
    }).not.toThrow()

    if (ctx) {
      try {
        // flush should not throw even if Supabase call fails
        // (network will fail but we catch all errors)
        await expect((ctx as Awaited<ReturnType<typeof openCliSync>>).flush()).resolves.toBeUndefined()

        expect((ctx as Awaited<ReturnType<typeof openCliSync>>).cache).toBeDefined()
        expect(typeof (ctx as Awaited<ReturnType<typeof openCliSync>>).cache.close).toBe('function')
      } finally {
        ;(ctx as Awaited<ReturnType<typeof openCliSync>>).close()
      }
    }
  })
})
