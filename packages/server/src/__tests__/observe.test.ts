import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { handleObserve } from '../tools/observe'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-project-observe'

describe('handleObserve', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-observe-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('extracts a decision from observation', async () => {
    const result = await handleObserve(
      { observation: 'I decided to use Express instead of Fastify for the API server.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('pending verification')
    expect(result.content[0].text).toContain('decision')
  })

  it('extracts a convention from observation', async () => {
    const result = await handleObserve(
      { observation: 'We always use PascalCase for React component filenames.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('convention')
  })

  it('extracts a lesson from observation', async () => {
    const result = await handleObserve(
      { observation: 'Watch out for the race condition in the cache invalidation code.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('lesson')
  })

  it('skips short observations', async () => {
    const result = await handleObserve(
      { observation: 'ok done' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toBe('Observation noted.')
    expect(cache.getAllForProject(TEST_PROJECT).length).toBe(0)
  })

  it('skips unclassifiable observations', async () => {
    const result = await handleObserve(
      { observation: 'The weather is nice today and I am having a good time coding.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toBe('Observation noted.')
  })

  it('blocks observations containing API keys', async () => {
    const result = await handleObserve(
      { observation: 'I decided to use the API key sk_live_1234567890abcdefghijklmn for production.' },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('skipped')
    expect(result.content[0].text).toContain('sensitive')
    expect(cache.getAllForProject(TEST_PROJECT).length).toBe(0)
  })

  it('sets confidence to 0.7 for observed memories', async () => {
    await handleObserve(
      { observation: 'I chose to implement the auth flow using httpOnly cookies instead of localStorage.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems[0].confidence).toBe(0.7)
  })

  it('tags observed memories with auto-observed', async () => {
    await handleObserve(
      { observation: 'The convention is to never use default exports in this project.' },
      TEST_PROJECT, cache, null,
    )
    const mems = cache.getAllForProject(TEST_PROJECT)
    expect(mems[0].tags).toContain('auto-observed')
  })
})
