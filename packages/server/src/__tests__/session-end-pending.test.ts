/**
 * Phase 1: Verify that handleSessionEnd writes extracted memories as
 * status='pending', not 'live'. This is the core behavior change that
 * routes session-extracted memories to the review queue.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleSessionEnd } from '../tools/session-end'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-session-pending'

describe('handleSessionEnd — pending status (Phase 1)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-pending-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('writes extracted memories with status=pending, not live', async () => {
    await handleSessionEnd(
      { summary: 'We decided to use PostgreSQL instead of MongoDB for the database.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.length).toBeGreaterThan(0)
    for (const m of mems) {
      expect(m.status).toBe('pending')
    }
  })

  it('does not write any live memories for session-extracted content', async () => {
    await handleSessionEnd(
      {
        summary:
          'The naming convention is to always use camelCase. ' +
          'We decided on microservice architecture with three layers: API, service, and repository. ' +
          'Watch out for stale cache reads after writes.',
      },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    const liveMems = mems.filter(m => m.status === 'live')
    expect(liveMems).toHaveLength(0)
    expect(mems.filter(m => m.status === 'pending').length).toBeGreaterThan(0)
  })

  it('response text mentions pending and suggests tages pending', async () => {
    const result = await handleSessionEnd(
      { summary: 'I decided to use Redis for caching instead of Memcached.' },
      TEST_PROJECT, cache, null,
    )
    const text = result.content[0].text
    expect(text).toContain('pending')
    expect(text).toContain('tages pending')
  })

  it('still sets confidence to 0.8 for pending memories', async () => {
    await handleSessionEnd(
      { summary: 'We chose to use Zod for all runtime validation.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.length).toBeGreaterThan(0)
    for (const m of mems) {
      expect(m.confidence).toBe(0.8)
    }
  })

  it('still tags memories with session-extract', async () => {
    await handleSessionEnd(
      { summary: 'The architecture lives in the packages directory, organized by domain.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.length).toBeGreaterThan(0)
    for (const m of mems) {
      expect(m.tags).toContain('session-extract')
    }
  })

  it('returns no-extract message and stores nothing when extractMemories is false', async () => {
    const result = await handleSessionEnd(
      { summary: 'I decided to use Postgres.', extractMemories: false },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('recorded')
    expect(cache.getAllForProject(TEST_PROJECT)).toHaveLength(0)
  })
})
