import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleContextualRecall } from '../tools/contextual-recall'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-contextual-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(
  cache: SqliteCache,
  overrides: {
    key: string
    value: string
    conditions?: string[]
    phases?: string[]
    agentName?: string
    filePaths?: string[]
  },
) {
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key: overrides.key,
    value: overrides.value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: overrides.filePaths || [],
    tags: [],
    conditions: overrides.conditions,
    phases: overrides.phases,
    agentName: overrides.agentName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('contextual recall', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    const result = createTestCache()
    cache = result.cache
    dbPath = result.dbPath
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('returns all live memories when no context provided', async () => {
    makeMemory(cache, { key: 'key-a', value: 'value alpha' })
    makeMemory(cache, { key: 'key-b', value: 'value beta' })
    const result = await handleContextualRecall(
      { query: '', context: {} },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('Found')
  })

  it('filters by agent name', async () => {
    makeMemory(cache, { key: 'agent-mem', value: 'stored by bot-x', agentName: 'bot-x' })
    makeMemory(cache, { key: 'other-mem', value: 'stored by bot-y', agentName: 'bot-y' })
    const result = await handleContextualRecall(
      { query: 'stored', context: { agentName: 'bot-x' } },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('agent-mem')
    expect(result.content[0].text).not.toContain('other-mem')
  })

  it('filters by phase', async () => {
    makeMemory(cache, { key: 'plan-mem', value: 'planning memory', phases: ['planning'] })
    makeMemory(cache, { key: 'impl-mem', value: 'implementation memory', phases: ['implementation'] })
    const result = await handleContextualRecall(
      { query: 'memory', context: { phase: 'planning' } },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('plan-mem')
    expect(result.content[0].text).not.toContain('impl-mem')
  })

  it('condition match on file names filters correctly', async () => {
    makeMemory(cache, {
      key: 'auth-mem',
      value: 'auth convention',
      conditions: ['lib/auth.ts', 'when working on auth'],
    })
    makeMemory(cache, {
      key: 'db-mem',
      value: 'db convention',
      conditions: ['lib/db.ts'],
    })
    const result = await handleContextualRecall(
      { query: 'convention', context: { currentFiles: ['lib/auth.ts'] } },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('auth-mem')
    expect(result.content[0].text).not.toContain('db-mem')
  })

  it('partial context match (only some conditions match)', async () => {
    makeMemory(cache, {
      key: 'partial-mem',
      value: 'partial match',
      conditions: ['lib/auth.ts', 'lib/utils.ts'],
    })
    const result = await handleContextualRecall(
      { query: 'partial', context: { currentFiles: ['lib/auth.ts', 'lib/other.ts'] } },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('partial-mem')
  })

  it('empty context returns matches for query only', async () => {
    makeMemory(cache, { key: 'match-key', value: 'findable content' })
    makeMemory(cache, { key: 'no-match', value: 'unrelated stuff xyz' })
    const result = await handleContextualRecall(
      { query: 'findable', context: {} },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('match-key')
  })

  it('no results returns appropriate message', async () => {
    const result = await handleContextualRecall(
      { query: 'totally missing xyz123', context: {} },
      TEST_PROJECT, cache, null,
    )
    expect(result.content[0].text).toContain('No memories found')
  })
})
