/**
 * embedOnWrite (0.5.7 bug 1): the ONE embedding path for every write
 * (remember, observe, session_end, verify_memory, import_claude_md).
 *
 * Runs the REAL embeddings module against a mocked fetch, so the long-input
 * test proves the chunk + mean-pool path, not a mock of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { embedOnWrite } from '../tools/embed-on-write'
import { __resetEmbeddingProviderForTests } from '../embeddings'
import { estimateTokenCount } from '../chunking'

const PROJECT = 'embed-on-write-project'
const ENV_KEYS = ['TAGES_EMBED_PROVIDER', 'OPENAI_API_KEY', 'SUPABASE_URL', 'TAGES_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'TAGES_EMBED_URL', 'TAGES_ENCRYPTION_KEY']

function readEmbedding(dbPath: string, key: string): number[] | null {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.prepare('SELECT embedding FROM memories WHERE project_id = ? AND key = ?').get(PROJECT, key) as { embedding: string | null } | undefined
    return row?.embedding ? JSON.parse(row.embedding) : null
  } finally {
    db.close()
  }
}

function makeMemory(value: string): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: PROJECT, key: `k-${randomUUID().slice(0, 8)}`, value,
    type: 'convention', source: 'agent', status: 'pending', confidence: 0.7,
    filePaths: [], tags: [], createdAt: now, updatedAt: now,
  }
}

function makeSync(extra: Record<string, unknown> = {}) {
  return {
    remoteUpdateEmbedding: vi.fn(async () => true),
    remoteUpsertChunks: vi.fn(async () => true),
    ...extra,
  } as unknown as SupabaseSync & { remoteUpdateEmbedding: ReturnType<typeof vi.fn>; remoteUpsertChunks: ReturnType<typeof vi.fn> }
}

/** OpenAI-shaped response; records every input it was asked to embed. */
function openAiFetch(inputs: string[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    inputs.push(body.input)
    return { ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.02) }] }) }
  })
}

describe('embedOnWrite', () => {
  let cache: SqliteCache
  let dbPath: string
  const savedEnv: Record<string, string | undefined> = {}
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
    dbPath = path.join(os.tmpdir(), `tages-embed-on-write-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k] }
    __resetEmbeddingProviderForTests()
    vi.restoreAllMocks()
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  function useOpenAi() {
    process.env.TAGES_EMBED_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'test-key'
    __resetEmbeddingProviderForTests()
  }

  it('stores the pooled embedding locally and pushes it remotely, plus chunk rows', async () => {
    useOpenAi()
    const inputs: string[] = []
    globalThis.fetch = openAiFetch(inputs) as unknown as typeof fetch
    const mem = makeMemory('Always use snake_case for API route names in this service.')
    cache.upsertMemory(mem, true)
    const sync = makeSync()

    await embedOnWrite(mem, mem.value, cache, sync)

    const stored = readEmbedding(dbPath, mem.key)
    expect(stored).not.toBeNull()
    expect(stored!.length).toBe(1536)
    expect(sync.remoteUpdateEmbedding).toHaveBeenCalledWith(PROJECT, mem.key, expect.any(Array))
    expect(sync.remoteUpsertChunks).toHaveBeenCalledWith(PROJECT, mem.key, expect.any(Array))
    expect(cache.getChunksForMemory(mem.id).length).toBeGreaterThan(0)
  })

  it('embeds the plaintext argument, never memory.value (which may be ciphertext)', async () => {
    useOpenAi()
    const inputs: string[] = []
    globalThis.fetch = openAiFetch(inputs) as unknown as typeof fetch
    const mem = { ...makeMemory('CIPHERTEXT-v1:abcdef'), encrypted: true }
    cache.upsertMemory(mem, true)

    await embedOnWrite(mem, 'the real plaintext rule', cache, null)

    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every(i => i.includes('the real plaintext rule'))).toBe(true)
    expect(inputs.some(i => i.includes('CIPHERTEXT'))).toBe(false)
  })

  it('a ~40k-character value (> 8192 tokens) gets a non-null pooled embedding through the chunk path', async () => {
    useOpenAi()
    const inputs: string[] = []
    globalThis.fetch = openAiFetch(inputs) as unknown as typeof fetch
    const long = Array.from({ length: 4000 }, (_, i) => `word${i} rule`).join(' ').slice(0, 40_000)
    expect(estimateTokenCount(long)).toBeGreaterThan(8192)
    const mem = makeMemory(long)
    cache.upsertMemory(mem, true)

    await embedOnWrite(mem, long, cache, null)

    const stored = readEmbedding(dbPath, mem.key)
    expect(stored).not.toBeNull()
    expect(stored!.length).toBe(1536)
    // Chunked: no single request carried the whole 40k-char value.
    expect(inputs.length).toBeGreaterThan(1)
    expect(inputs.every(i => i.length < long.length)).toBe(true)
  })

  it('logs (does not swallow) a null embedding, and never rejects', async () => {
    useOpenAi()
    globalThis.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mem = makeMemory('Never deploy on Fridays without a rollback plan.')
    cache.upsertMemory(mem, true)
    const sync = makeSync()

    await expect(embedOnWrite(mem, mem.value, cache, sync)).resolves.toBeUndefined()

    expect(readEmbedding(dbPath, mem.key)).toBeNull()
    expect(sync.remoteUpdateEmbedding).not.toHaveBeenCalled()
    const logged = errSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logged).toMatch(new RegExp(`No embedding generated for "${mem.key}"|Embedding generation/sync failed`))
  })

  it('timeoutMs caps the wait without rejecting', async () => {
    useOpenAi()
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mem = makeMemory('A rule whose embedding call never returns.')
    cache.upsertMemory(mem, true)

    const started = Date.now()
    await embedOnWrite(mem, mem.value, cache, null, undefined, { timeoutMs: 50 })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('reuses the sync\'s authenticated client for the hosted provider when none is passed', async () => {
    // observe/session_end/verify/import are wired in index.ts without a
    // supabaseClient; without this fallback hosted embedding gets no URL/token.
    process.env.TAGES_EMBED_PROVIDER = 'hosted'
    __resetEmbeddingProviderForTests()
    const urls: string[] = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url)
      const body = JSON.parse(String(init?.body ?? '{}'))
      const count = Array.isArray(body.texts) ? body.texts.length : 1
      return { ok: true, json: async () => ({ model: 'gte-small', dims: 384, embeddings: Array.from({ length: count }, () => new Array(384).fill(0.05)) }) }
    }) as unknown as typeof fetch
    const client = {
      supabaseUrl: 'https://sync-client.supabase.co',
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    }
    const sync = makeSync({ supabase: client })
    const mem = makeMemory('Hosted embedding via the sync client.')
    cache.upsertMemory(mem, true)

    await embedOnWrite(mem, mem.value, cache, sync)

    expect(urls.some(u => u.startsWith('https://sync-client.supabase.co/functions/v1/embed'))).toBe(true)
    expect(readEmbedding(dbPath, mem.key)).not.toBeNull()
  })
})
