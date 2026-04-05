import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleSessionEnd } from '../tools/session-end'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-session'

describe('handleSessionEnd', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-session-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('extracts decision memories from summary', async () => {
    const result = await handleSessionEnd(
      { summary: 'I decided to use PostgreSQL instead of MongoDB for the database.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Extracted')
    expect(result.content[0].text).toContain('decision')
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.some(m => m.type === 'decision')).toBe(true)
  })

  it('extracts convention memories from summary', async () => {
    const result = await handleSessionEnd(
      { summary: 'The naming convention is to always use camelCase for function names.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('convention')
  })

  it('extracts lesson memories from summary', async () => {
    await handleSessionEnd(
      { summary: 'I learned that the cache must be invalidated after writes. Watch out for stale reads.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.some(m => m.type === 'lesson')).toBe(true)
  })

  it('extracts architecture memories from summary', async () => {
    await handleSessionEnd(
      { summary: 'The module structure has three layers: API, service, and repository.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems.some(m => m.type === 'architecture')).toBe(true)
  })

  it('skips extraction when extractMemories is false', async () => {
    const result = await handleSessionEnd(
      { summary: 'I decided to use Postgres.', extractMemories: false },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('recorded')
    expect(cache.getAllForProject(TEST_PROJECT).length).toBe(0)
  })

  it('returns no-extract message for short/generic summaries', async () => {
    const result = await handleSessionEnd(
      { summary: 'Done for today.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('No extractable memories')
  })

  it('sets confidence to 0.8 for auto-extracted memories', async () => {
    await handleSessionEnd(
      { summary: 'We chose to use Redis for caching instead of Memcached.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems[0].confidence).toBe(0.8)
  })

  it('tags extracted memories with session-extract', async () => {
    await handleSessionEnd(
      { summary: 'The architecture uses a microservice pattern with separate modules for auth and billing.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems[0].tags).toContain('session-extract')
  })
})
