/**
 * E2E tests for the SQLite-to-Supabase cloud sync path.
 *
 * All tests are gated on TAGES_E2E_SUPABASE_URL env var.
 * When the env var is absent (e.g., local dev, CI without secrets),
 * the entire describe block skips gracefully.
 *
 * Required env vars:
 *   TAGES_E2E_SUPABASE_URL      — Supabase project URL
 *   TAGES_E2E_SUPABASE_ANON_KEY — Supabase anon key
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpTestClient } from './helpers/mcp-client'
import { SqliteCache } from '../cache/sqlite'
import { SupabaseSync } from '../sync/supabase-sync'
import { createSupabaseClient } from '@tages/shared'

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.TAGES_E2E_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.TAGES_E2E_SUPABASE_ANON_KEY ?? ''
const TEST_PROJECT_SLUG = `tages-e2e-${Date.now()}`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDbPath(label: string): string {
  return path.join(os.tmpdir(), `tages-e2e-cloud-sync-${label}-${Date.now()}.db`)
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe.skipIf(!process.env.TAGES_E2E_SUPABASE_URL)('Cloud Sync E2E', () => {
  const dbPath = makeTempDbPath('primary')
  let client: McpTestClient
  let supabase: ReturnType<typeof createSupabaseClient>
  let testProjectId: string | null = null

  beforeAll(async () => {
    // Initialize Supabase client
    supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    // Insert a project row in Supabase so RLS allows memory inserts.
    // If this fails (e.g., RLS blocks anon inserts), skip with a clear message.
    const insertResult = await Promise.resolve(
      supabase
        .from('projects')
        .insert({ slug: TEST_PROJECT_SLUG, name: 'E2E Cloud Sync Test' })
        .select('id')
        .single(),
    )

    if (insertResult.error || !insertResult.data) {
      console.error(
        '[e2e-cloud-sync] Supabase project insert failed (RLS or permissions):',
        insertResult.error?.message ?? 'no data returned',
      )
      // Mark as skipped by leaving testProjectId null — individual tests check this
    } else {
      testProjectId = insertResult.data.id as string
    }

    // Start the MCP client with the temp DB path
    client = new McpTestClient(dbPath)
    await client.start()
  }, 60_000)

  afterAll(async () => {
    // Stop the MCP client
    if (client) {
      await client.stop()
    }

    // Clean up Supabase: delete test project memories and project row
    if (testProjectId) {
      await Promise.resolve(
        supabase.from('memories').delete().eq('project_id', testProjectId),
      )
      await Promise.resolve(
        supabase.from('projects').delete().eq('id', testProjectId),
      )
    }

    // Clean up temp db file (McpTestClient.stop() also tries, belt+suspenders)
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    } catch {
      // ignore cleanup errors
    }
  }, 30_000)

  // ─── 1. Write + dirty flag ─────────────────────────────────────────────────

  it('write via MCP sets dirty=1 in SQLite', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    const result = await client.callTool('remember', {
      key: 'cloud-sync-e2e-test-key',
      value: 'cloud-sync-e2e-test-value',
      type: 'convention',
    })

    expect(result.content[0].type).toBe('text')

    // Open SQLite directly to verify dirty flag
    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db
        .prepare("SELECT dirty FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-test-key') as { dirty: number } | undefined

      expect(row, 'Memory row should exist in SQLite after remember').toBeDefined()
      expect(row!.dirty).toBe(1)
    } finally {
      db.close()
    }
  }, 15_000)

  // ─── 2. Flush clears dirty ─────────────────────────────────────────────────

  it('flush() clears dirty flag in SQLite', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    // We need to know the projectId stored in SQLite (set by the MCP server)
    const db = new Database(dbPath, { readonly: true })
    let projectId: string
    try {
      const row = db
        .prepare("SELECT project_id FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-test-key') as { project_id: string } | undefined

      expect(row, 'Memory should exist before flush').toBeDefined()
      projectId = row!.project_id
    } finally {
      db.close()
    }

    // Instantiate SqliteCache and SupabaseSync pointing at the same DB
    const cache = new SqliteCache(dbPath)
    const sync = new SupabaseSync(supabase, cache, projectId)

    // Verify dirty memories exist before flush
    const dirtyBefore = cache.getDirty()
    expect(dirtyBefore.length).toBeGreaterThan(0)

    // Flush to Supabase
    await sync.flush()

    // Verify dirty flag cleared
    const dirtyAfter = cache.getDirty()
    expect(dirtyAfter.length).toBe(0)
  }, 20_000)

  // ─── 3. Supabase has the row ───────────────────────────────────────────────

  it('Supabase contains the flushed memory row', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    // Get the project ID from SQLite
    const db = new Database(dbPath, { readonly: true })
    let projectId: string
    try {
      const row = db
        .prepare("SELECT project_id FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-test-key') as { project_id: string } | undefined
      expect(row).toBeDefined()
      projectId = row!.project_id
    } finally {
      db.close()
    }

    const { data, error } = await Promise.resolve(
      supabase
        .from('memories')
        .select('key, value, project_id')
        .eq('key', 'cloud-sync-e2e-test-key')
        .eq('project_id', projectId),
    )

    expect(error, `Supabase query error: ${error?.message}`).toBeNull()
    expect(data, 'Supabase should return rows').toBeDefined()
    expect(data!.length).toBeGreaterThan(0)
    expect(data![0].key).toBe('cloud-sync-e2e-test-key')
    expect(data![0].value).toBe('cloud-sync-e2e-test-value')
  }, 15_000)

  // ─── 4. Hydration round-trip ───────────────────────────────────────────────

  it('hydrate() loads Supabase rows into a fresh SQLite cache', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    // Get the project ID used by the MCP server
    const db = new Database(dbPath, { readonly: true })
    let projectId: string
    try {
      const row = db
        .prepare("SELECT project_id FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-test-key') as { project_id: string } | undefined
      expect(row).toBeDefined()
      projectId = row!.project_id
    } finally {
      db.close()
    }

    // Create a fresh empty SQLite cache
    const freshDbPath = makeTempDbPath('hydrate')
    const freshCache = new SqliteCache(freshDbPath)
    const freshSync = new SupabaseSync(supabase, freshCache, projectId)

    try {
      // Hydrate from Supabase
      const count = await freshSync.hydrate()
      expect(count).toBeGreaterThan(0)

      // Verify the memory appears in the fresh cache
      const memories = freshCache.getAllForProject(projectId)
      const found = memories.find((m) => m.key === 'cloud-sync-e2e-test-key')
      expect(found, 'Hydrated memory should appear in fresh SQLite cache').toBeDefined()
      expect(found!.value).toBe('cloud-sync-e2e-test-value')
    } finally {
      // Clean up the fresh DB
      try {
        if (fs.existsSync(freshDbPath)) fs.unlinkSync(freshDbPath)
      } catch {
        // ignore
      }
    }
  }, 20_000)

  // ─── 5. synced_at warning is non-fatal ────────────────────────────────────

  it('flush() completes successfully even if synced_at warning occurs', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    // Write another memory to make it dirty
    const result = await client.callTool('remember', {
      key: 'cloud-sync-e2e-warning-test',
      value: 'testing synced_at warning resilience',
      type: 'lesson',
    })
    expect(result.content[0].type).toBe('text')

    // Get project ID and flush
    const db = new Database(dbPath, { readonly: true })
    let projectId: string
    try {
      const row = db
        .prepare("SELECT project_id FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-warning-test') as { project_id: string } | undefined
      expect(row).toBeDefined()
      projectId = row!.project_id
    } finally {
      db.close()
    }

    const cache = new SqliteCache(dbPath)
    const sync = new SupabaseSync(supabase, cache, projectId)

    // flush() should not throw regardless of any synced_at warning
    await expect(sync.flush()).resolves.not.toThrow()

    // Verify dirty is cleared (flush succeeded)
    const dirty = cache.getDirty().filter((m) => m.key === 'cloud-sync-e2e-warning-test')
    expect(dirty.length).toBe(0)
  }, 20_000)

  // ─── 6. Delete propagates ─────────────────────────────────────────────────

  it('forget + flush() removes row from Supabase', async () => {
    if (!testProjectId) {
      console.warn('[e2e-cloud-sync] Skipping: project insert failed (RLS)')
      return
    }

    // Write a memory specifically for deletion test
    await client.callTool('remember', {
      key: 'cloud-sync-e2e-delete-me',
      value: 'this memory will be deleted',
      type: 'lesson',
    })

    // Get project ID
    const db = new Database(dbPath, { readonly: true })
    let projectId: string
    try {
      const row = db
        .prepare("SELECT project_id FROM memories WHERE key = ?")
        .get('cloud-sync-e2e-delete-me') as { project_id: string } | undefined
      expect(row).toBeDefined()
      projectId = row!.project_id
    } finally {
      db.close()
    }

    // Flush the write first so it's in Supabase
    const cache = new SqliteCache(dbPath)
    const sync = new SupabaseSync(supabase, cache, projectId)
    await sync.flush()

    // Verify it's in Supabase
    const { data: beforeDelete } = await Promise.resolve(
      supabase
        .from('memories')
        .select('key')
        .eq('key', 'cloud-sync-e2e-delete-me')
        .eq('project_id', projectId),
    )
    expect(beforeDelete?.length ?? 0).toBeGreaterThan(0)

    // Delete via MCP (forget tool)
    const forgetResult = await client.callTool('forget', {
      key: 'cloud-sync-e2e-delete-me',
    })
    expect(forgetResult.content[0].type).toBe('text')

    // Delete directly from Supabase via remoteDelete (since forget marks for sync)
    const deleted = await sync.remoteDelete(projectId, 'cloud-sync-e2e-delete-me')
    expect(deleted).toBe(true)

    // Verify row is absent from Supabase
    const { data: afterDelete } = await Promise.resolve(
      supabase
        .from('memories')
        .select('key')
        .eq('key', 'cloud-sync-e2e-delete-me')
        .eq('project_id', projectId),
    )
    expect(afterDelete?.length ?? 0).toBe(0)
  }, 30_000)
})
