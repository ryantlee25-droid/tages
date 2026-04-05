import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleImport } from '../tools/import'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-import-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

const SAMPLE_JSON = JSON.stringify([
  { key: 'auth-convention', value: 'Use JWT tokens', type: 'convention' },
  { key: 'db-pattern', value: 'Always use transactions', type: 'pattern' },
])

const SAMPLE_MARKDOWN = `## auth-convention
Use JWT tokens
**type:** convention

## db-pattern
Always use transactions
**type:** pattern
**tags:** database, safety
`

describe('import memories', () => {
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

  it('imports JSON array of memories', async () => {
    const { result } = await handleImport(
      { content: SAMPLE_JSON, format: 'json', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(cache.getByKey(TEST_PROJECT, 'auth-convention')).not.toBeNull()
  })

  it('imports markdown format', async () => {
    const { result } = await handleImport(
      { content: SAMPLE_MARKDOWN, format: 'markdown', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(2)
    expect(cache.getByKey(TEST_PROJECT, 'auth-convention')).not.toBeNull()
  })

  it('auto-detects JSON format', async () => {
    const { result } = await handleImport(
      { content: SAMPLE_JSON, format: 'auto', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(2)
  })

  it('skips duplicates with skip strategy', async () => {
    await handleImport(
      { content: SAMPLE_JSON, format: 'json', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    const { result } = await handleImport(
      { content: SAMPLE_JSON, format: 'json', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(2)
  })

  it('overwrites duplicates with overwrite strategy', async () => {
    await handleImport(
      { content: SAMPLE_JSON, format: 'json', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    const overrideJson = JSON.stringify([
      { key: 'auth-convention', value: 'Use OAuth now', type: 'convention' },
    ])
    const { result } = await handleImport(
      { content: overrideJson, format: 'json', strategy: 'overwrite', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(1)
    expect(cache.getByKey(TEST_PROJECT, 'auth-convention')?.value).toBe('Use OAuth now')
  })

  it('merges duplicates with merge strategy', async () => {
    await handleImport(
      { content: JSON.stringify([{ key: 'merge-key', value: 'Part A', type: 'convention' }]),
        format: 'json', strategy: 'skip', projectId: TEST_PROJECT },
      cache, null,
    )
    const { result } = await handleImport(
      { content: JSON.stringify([{ key: 'merge-key', value: 'Part B', type: 'convention' }]),
        format: 'json', strategy: 'merge', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.merged).toBe(1)
    const merged = cache.getByKey(TEST_PROJECT, 'merge-key')
    expect(merged?.value).toContain('Part A')
    expect(merged?.value).toContain('Part B')
  })

  it('returns error for invalid JSON', async () => {
    const { result } = await handleImport(
      { content: 'not valid json {{}', format: 'json', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.imported).toBe(0)
  })

  it('handles empty JSON array', async () => {
    const { result } = await handleImport(
      { content: '[]', format: 'json', projectId: TEST_PROJECT },
      cache, null,
    )
    expect(result.imported).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})
