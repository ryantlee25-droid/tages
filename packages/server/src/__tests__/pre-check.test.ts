import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handlePreCheck } from '../tools/pre-check'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-pre-check-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-pre-check-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function seedMemory(
  cache: SqliteCache,
  overrides: {
    key: string
    value: string
    type: string
    filePaths?: string[]
    conditions?: string[]
  },
) {
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key: overrides.key,
    value: overrides.value,
    type: overrides.type as any,
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: overrides.filePaths || [],
    tags: [],
    conditions: overrides.conditions,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('pre_check tool', () => {
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

  it('returns anti_pattern memories matching task description', async () => {
    seedMemory(cache, {
      key: 'no-direct-db-calls',
      value: 'Never call the database directly from components',
      type: 'anti_pattern',
    })

    // Use a query that shares tokens with the memory: "database", "directly"
    const result = await handlePreCheck(
      { taskDescription: 'call database directly from component' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('no-direct-db-calls')
    expect(result.content[0].text).toContain('Anti-Patterns')
  })

  it('returns convention memories matching task description', async () => {
    seedMemory(cache, {
      key: 'zod-validation-required',
      value: 'All MCP tool inputs must use Zod schemas for validation',
      type: 'convention',
    })

    // Shares tokens: "zod", "schemas", "validation"
    const result = await handlePreCheck(
      { taskDescription: 'add zod schemas for validation' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('zod-validation-required')
    expect(result.content[0].text).toContain('Conventions')
  })

  it('returns convention memories matching file paths', async () => {
    // Memory with a unique key/value that won't match a random query,
    // but WILL match via filePaths overlap
    seedMemory(cache, {
      key: 'schema-file-convention',
      value: 'All Zod schemas must be exported from schemas file',
      type: 'convention',
      filePaths: ['packages/server/src/schemas.ts'],
    })
    // Unrelated memory (different filePath, no query overlap)
    seedMemory(cache, {
      key: 'cli-chalk-convention',
      value: 'Use chalk for CLI output coloring',
      type: 'convention',
      filePaths: ['packages/cli/src/index.ts'],
    })

    // Task query does not overlap with either memory key/value,
    // so filePaths matching is the only way schema-file-convention appears
    const result = await handlePreCheck(
      {
        taskDescription: 'refactor the xyz unrelated thing abc',
        filePaths: ['packages/server/src/schemas.ts'],
      },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('schema-file-convention')
    expect(result.content[0].text).not.toContain('cli-chalk-convention')
  })

  it('returns empty message when no relevant memories exist', async () => {
    const result = await handlePreCheck(
      { taskDescription: 'zzzzxyzzy completely unrelated qqqq' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('No gotchas found')
  })

  it('handles the case where filePaths is omitted', async () => {
    seedMemory(cache, {
      key: 'lesson-always-test',
      value: 'Always run tests before committing changes',
      type: 'lesson',
    })

    // Shares tokens: "tests", "committing"
    const result = await handlePreCheck(
      { taskDescription: 'run tests before committing' },
      TEST_PROJECT,
      cache,
      null,
    )

    // Should work without filePaths — no crash
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
  })

  it('groups results by type in output', async () => {
    seedMemory(cache, {
      key: 'anti-pattern-any-type',
      value: 'Do not use TypeScript any type, always type explicitly',
      type: 'anti_pattern',
    })
    seedMemory(cache, {
      key: 'convention-strict-mode',
      value: 'Use TypeScript strict mode everywhere in the codebase',
      type: 'convention',
    })

    // Shares tokens with both: "typescript", "type"
    const result = await handlePreCheck(
      { taskDescription: 'write TypeScript code with type annotations' },
      TEST_PROJECT,
      cache,
      null,
    )

    const text = result.content[0].text
    // Both types should appear
    expect(text).toContain('Anti-Patterns')
    expect(text).toContain('Conventions')
  })

  it('includes lesson type memories in results', async () => {
    seedMemory(cache, {
      key: 'lesson-supabase-promiselike',
      value: 'Supabase returns PromiseLike not Promise — wrap with Promise resolve for catch',
      type: 'lesson',
    })

    // Shares tokens: "supabase", "promise"
    const result = await handlePreCheck(
      { taskDescription: 'call supabase and handle promise errors' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('lesson-supabase-promiselike')
    expect(result.content[0].text).toContain('Lessons Learned')
  })
})
