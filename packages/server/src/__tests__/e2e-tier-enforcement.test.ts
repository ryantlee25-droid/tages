/**
 * E2E Tier Enforcement Tests
 *
 * Tests that free-tier limits are enforced correctly by the MCP server.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import { McpTestClient } from './helpers/mcp-client'

function makeTempDbPath(): string {
  return path.join(os.tmpdir(), `tages-tier-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

/**
 * Pre-seed the SQLite database with N memory rows for a given project_id.
 * Uses a single transaction for speed. Must be called before starting the MCP server
 * so that the server process picks up the pre-seeded data.
 */
function seedMemories(dbPath: string, projectId: string, count: number): void {
  // Initialize the schema by running the CREATE TABLE statements directly.
  // We replicate the minimum schema needed for the memories table.
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      agent_name TEXT,
      file_paths TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      embedding TEXT,
      status TEXT NOT NULL DEFAULT 'live',
      conditions TEXT,
      phases TEXT,
      cross_system_refs TEXT,
      examples TEXT,
      execution_flow TEXT,
      verified_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS memories_project_key ON memories(project_id, key);
    CREATE INDEX IF NOT EXISTS memories_project_id ON memories(project_id);
    CREATE INDEX IF NOT EXISTS memories_type ON memories(project_id, type);
    CREATE INDEX IF NOT EXISTS memories_dirty ON memories(dirty) WHERE dirty = 1;

    CREATE TABLE IF NOT EXISTS sync_meta (
      project_id TEXT PRIMARY KEY,
      last_synced_at TEXT,
      memory_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      version INTEGER NOT NULL DEFAULT 1,
      changed_by TEXT,
      change_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_conflicts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      memory_a_key TEXT NOT NULL,
      memory_b_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolution_strategy TEXT,
      merged_value TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const insert = db.prepare(
    `INSERT OR IGNORE INTO memories (id, project_id, key, value, type, status)
     VALUES (?, ?, ?, ?, 'fact', 'live')`
  )

  const insertMany = db.transaction((rows: Array<[string, string, string, string]>) => {
    for (const row of rows) {
      insert.run(...row)
    }
  })

  const rows: Array<[string, string, string, string]> = []
  for (let i = 0; i < count; i++) {
    const id = `seed-${i.toString().padStart(6, '0')}`
    rows.push([id, projectId, `seeded-key-${i}`, `seeded-value-${i}`])
  }

  insertMany(rows)
  db.close()
}

describe('Tier Enforcement E2E', () => {
  describe('Test 1: 10K memory limit on free tier', () => {
    let dbPath: string
    let client: McpTestClient

    beforeEach(async () => {
      dbPath = makeTempDbPath()

      // Pre-seed 10,000 rows for the default project_id.
      // The MCP server uses the project slug from TAGES_PROJECT_SLUG env var; when absent
      // (no config file), it falls back to 'local' (see index.ts: const projectId = config?.project.projectId || 'local').
      seedMemories(dbPath, 'local', 10000)

      client = new McpTestClient(dbPath)
      await client.start()
    }, 30000)

    afterEach(async () => {
      await client.stop()
    })

    it('returns a limit/upgrade message instead of crashing when memory #10,001 is added', async () => {
      const result = await client.callTool('remember', {
        key: 'over-limit-key',
        value: 'this should be rejected by the free tier limit',
        type: 'pattern',
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')

      const text = result.content[0].text
      // Should mention the limit or upgrade — NOT an error/crash response
      expect(text).toMatch(/limit|upgrade/i)
      // Should NOT be a generic server error
      expect(text).not.toMatch(/internal server error/i)
      expect(text).not.toMatch(/unexpected error/i)
    }, 30000)
  })

  describe('Test 2: 2-project limit', () => {
    // TODO: 2-project limit is enforced via Supabase RLS only.
    // Cannot be tested locally without a Supabase instance.
    // See: supabase/migrations/ for project-level RLS policies
    //
    // The server-side code (tier-config.ts, index.ts, tools/remember.ts) does not
    // enforce a 2-project limit. The limit is applied at the Supabase Postgres layer
    // via Row-Level Security (RLS) policies that restrict the number of projects a
    // free-tier user can create. Local SQLite runs have no such enforcement.

    it.skip('enforces 2-project limit for free tier (requires Supabase)', () => {
      // This test cannot run locally. To test this:
      // 1. Set up a Supabase instance with the migrations applied
      // 2. Create a free-tier user
      // 3. Create 2 projects via the dashboard or CLI
      // 4. Attempt to create a 3rd project and verify the RLS policy blocks it
      //
      // The relevant RLS policy is in:
      //   supabase/migrations/ — look for project-count or free-tier restrictions
    })
  })
})
