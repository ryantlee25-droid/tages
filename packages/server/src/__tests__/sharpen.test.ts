import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { SqliteCache } from '../cache/sqlite'
import { handleSharpenMemory } from '../tools/sharpen'
import type { Memory } from '@tages/shared'

const PROJECT = 'sharpen-test'

function makeTmpDbPath(): string {
  return path.join(os.tmpdir(), `tages-sharpen-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function makeMemory(key: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value: 'Supabase returns PromiseLike not Promise, wrap with Promise.resolve()',
    type: 'lesson',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function mockFetchRewrite(rewritten: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: rewritten }],
    }),
  }))
}

describe('handleSharpenMemory', () => {
  let dbPath: string
  let cache: SqliteCache

  beforeEach(() => {
    dbPath = makeTmpDbPath()
    cache = new SqliteCache(dbPath)
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    cache.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('preview mode returns before/after without mutating cache', async () => {
    const memory = makeMemory('supabase-promiselike')
    cache.upsertMemory(memory)
    mockFetchRewrite('ALWAYS wrap Supabase calls with Promise.resolve() for .catch() support.')

    const result = await handleSharpenMemory({ key: 'supabase-promiselike', confirmed: false }, PROJECT, cache, null)
    const text = result.content.map((c) => c.text).join('\n')

    expect(text).toContain('Preview')
    expect(text).toContain('Before:')
    expect(text).toContain('After:')
    expect(text).toContain('confirmed=true')

    // Cache should NOT be mutated
    const unchanged = cache.getByKey(PROJECT, 'supabase-promiselike')
    expect(unchanged?.value).toBe(memory.value)
  })

  it('confirmed mode upserts and adds sharpened tag', async () => {
    const memory = makeMemory('supabase-promiselike', { tags: ['existing-tag'] })
    cache.upsertMemory(memory)
    const rewritten = 'ALWAYS wrap Supabase calls with Promise.resolve() for .catch() support.'
    mockFetchRewrite(rewritten)

    const result = await handleSharpenMemory({ key: 'supabase-promiselike', confirmed: true }, PROJECT, cache, null)
    const text = result.content.map((c) => c.text).join('\n')

    expect(text).toContain('Sharpened')
    expect(text).toContain('Before:')
    expect(text).toContain('After:')

    const updated = cache.getByKey(PROJECT, 'supabase-promiselike')
    expect(updated?.value).toBe(rewritten)
    expect(updated?.tags).toContain('sharpened')
    expect(updated?.tags).toContain('existing-tag')
  })

  it('does not duplicate sharpened tag if already present', async () => {
    const memory = makeMemory('supabase-promiselike', { tags: ['sharpened'] })
    cache.upsertMemory(memory)
    mockFetchRewrite('ALWAYS wrap Supabase calls with Promise.resolve().')

    await handleSharpenMemory({ key: 'supabase-promiselike', confirmed: true }, PROJECT, cache, null)

    const updated = cache.getByKey(PROJECT, 'supabase-promiselike')
    const sharpenedCount = (updated?.tags ?? []).filter((t) => t === 'sharpened').length
    expect(sharpenedCount).toBe(1)
  })

  it('returns error message for missing memory', async () => {
    const result = await handleSharpenMemory({ key: 'does-not-exist', confirmed: false }, PROJECT, cache, null)
    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toContain('not found')
  })

  it('throws when ANTHROPIC_API_KEY not set', async () => {
    vi.unstubAllEnvs()
    delete process.env.ANTHROPIC_API_KEY

    const memory = makeMemory('supabase-promiselike')
    cache.upsertMemory(memory)

    await expect(
      handleSharpenMemory({ key: 'supabase-promiselike', confirmed: true }, PROJECT, cache, null)
    ).rejects.toThrow('ANTHROPIC_API_KEY not set')
  })
})
