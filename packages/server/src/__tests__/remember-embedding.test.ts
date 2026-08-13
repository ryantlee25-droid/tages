/**
 * Tests for Task 8: document embeddings generated + stored + synced on write.
 *
 * `handleRemember` used to never call `generateEmbedding`, so the pgvector
 * `embedding` column was a silent no-op product-wide. These tests mock
 * `generateEmbedding` (never hit real Ollama/OpenAI) and assert:
 *   1. It's called with the pre-encryption plaintext, never ciphertext.
 *   2. The local SQLite cache's embedding column gets populated.
 *   3. The computed embedding is pushed to Supabase via a mocked SupabaseSync.
 *   4. The tool response is not blocked on the (fire-and-forget) embedding call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleForget } from '../tools/forget'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { Memory } from '@tages/shared'

// rowToMemory (sqlite.ts) does not surface the raw embedding/dirty columns, so
// read them directly for the race assertions below.
function readRow(dbPath: string, projectId: string, key: string): { value: string; dirty: number; embedding: string | null } | undefined {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(
      'SELECT value, dirty, embedding FROM memories WHERE project_id = ? AND key = ?'
    ).get(projectId, key) as { value: string; dirty: number; embedding: string | null } | undefined
  } finally {
    db.close()
  }
}

const TEST_PROJECT = 'test-remember-embedding-project'
const VALID_KEY_HEX = 'b'.repeat(64)

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(),
}))

import { generateEmbedding } from '../embeddings'

const mockGenerateEmbedding = vi.mocked(generateEmbedding)

type EmbeddingUpdate = { projectId: string; key: string; embedding: number[] }
type MockSync = Omit<SupabaseSync, 'remoteInsert' | 'remoteUpdateEmbedding' | 'remoteDelete'> & {
  inserted: Memory[]
  embeddingUpdates: EmbeddingUpdate[]
  // Minimal in-memory model of the remote `memories` table so tests can prove
  // that a narrow embedding-only UPDATE is a no-op (never re-creates a row) on
  // a row deleted by a concurrent forget.
  remoteStore: Map<string, { value: string; embedding?: number[] }>
  remoteInsert: Mock
  remoteUpdateEmbedding: Mock
  remoteDelete: Mock
  markSynced: Mock
}

function makeMockSync(): MockSync {
  const mock = {
    inserted: [] as Memory[],
    embeddingUpdates: [] as EmbeddingUpdate[],
    remoteStore: new Map<string, { value: string; embedding?: number[] }>(),
    remoteInsert: vi.fn(async (mem: Memory) => {
      mock.inserted.push(mem)
      // upsert semantics: create-or-replace the row keyed by key
      mock.remoteStore.set(mem.key, { value: mem.value, embedding: mem.embedding })
      return true
    }),
    remoteUpdateEmbedding: vi.fn(async (projectId: string, key: string, embedding: number[]) => {
      mock.embeddingUpdates.push({ projectId, key, embedding })
      // update semantics: only mutate an EXISTING row, never create one
      const existing = mock.remoteStore.get(key)
      if (existing) existing.embedding = embedding
      return true
    }),
    remoteDelete: vi.fn(async (_projectId: string, key: string) => {
      mock.remoteStore.delete(key)
      return true
    }),
    markSynced: vi.fn(),
    startSync: vi.fn(),
    stopSync: vi.fn(),
    flush: vi.fn(async () => {}),
    hydrate: vi.fn(async () => 0),
    recoverWAL: vi.fn(async () => 0),
    remoteRecall: vi.fn(async () => null),
    remoteHybridRecall: vi.fn(async () => null),
    remoteGetByType: vi.fn(async () => null),
    remoteVerifyMemory: vi.fn(async () => true),
    remoteCountMemories: vi.fn(async () => 0),
    remoteFederatedInsert: vi.fn(async () => true),
    remoteListFederated: vi.fn(async () => null),
  }
  return mock as unknown as MockSync
}

// The fire-and-forget embedding task is not awaited by handleRemember.
// Flush the microtask queue (and the mocked async generateEmbedding's own
// resolution) before asserting on its side effects.
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

describe('Task 8: embedding write path', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-remember-embedding-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
    mockGenerateEmbedding.mockReset()
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('generates an embedding from plaintext and stores it in the local cache', async () => {
    const fakeEmbedding = new Array(1536).fill(0.01)
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding)

    await handleRemember(
      { key: 'embed-key', value: 'some memory value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('some memory value', expect.objectContaining({ projectId: TEST_PROJECT }))

    const row = cache.getByKey(TEST_PROJECT, 'embed-key')
    expect(row).not.toBeNull()
  })

  it('does not block the tool response on embedding generation', async () => {
    // generateEmbedding never resolves within this test's lifetime.
    mockGenerateEmbedding.mockImplementation(() => new Promise(() => {}))

    const start = Date.now()
    const result = await handleRemember(
      { key: 'slow-embed-key', value: 'value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )
    const elapsed = Date.now() - start

    expect(result.content[0].text).toContain('Stored memory')
    expect(elapsed).toBeLessThan(1000)
  })

  it('generates the embedding from plaintext, not ciphertext, when encryption is enabled', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    const fakeEmbedding = new Array(1536).fill(0.02)
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding)

    await handleRemember(
      { key: 'enc-embed-key', value: 'plaintext secret value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('plaintext secret value', expect.objectContaining({ projectId: TEST_PROJECT }))
    // Sanity: the stored value itself is ciphertext, confirming encryption ran
    // before the embedding call inspected the plaintext copy separately.
    const stored = cache.getByKey(TEST_PROJECT, 'enc-embed-key')
    expect(stored!.value).toMatch(/^enc:v1:/)
  })

  it('pushes the computed embedding to Supabase via a narrow embedding-only update', async () => {
    const fakeEmbedding = new Array(1536).fill(0.03)
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding)
    const sync = makeMockSync()

    await handleRemember(
      { key: 'sync-embed-key', value: 'value to embed', type: 'convention' },
      TEST_PROJECT,
      cache,
      sync as unknown as SupabaseSync,
    )

    await flushMicrotasks()

    // The write path does a single full-row remoteInsert (no embedding yet).
    // The fire-and-forget embedding path must NOT do a second full-row upsert
    // (that caused the data-loss / resurrection / stranded-flush races); it
    // does a narrow (projectId, key)-keyed embedding-only update instead.
    expect(sync.remoteInsert).toHaveBeenCalledTimes(1)
    expect(sync.remoteUpdateEmbedding).toHaveBeenCalledTimes(1)
    expect(sync.embeddingUpdates).toHaveLength(1)
    expect(sync.embeddingUpdates[0]).toMatchObject({
      projectId: TEST_PROJECT,
      key: 'sync-embed-key',
      embedding: fakeEmbedding,
    })
    // And it does not re-mark the whole memory synced from the embedding path.
    expect(sync.markSynced).not.toHaveBeenCalled()

    // Local cache carries the embedding on the existing row.
    const raw = readRow(dbPath, TEST_PROJECT, 'sync-embed-key')
    expect(JSON.parse(raw!.embedding!)).toEqual(fakeEmbedding)
  })

  /**
   * PLAN-HOSTED-EMBEDDING.md Task 2: the hosted provider needs a Supabase URL
   * and a bearer token to reach `${supabaseUrl}/functions/v1/embed`, and
   * SupabaseSync keeps its client private. handleRemember therefore takes a
   * trailing OPTIONAL `supabaseClient`, mirroring handleRecall. These two
   * tests pin both halves of that contract: the client reaches the embedding
   * call when supplied, and omitting it still compiles and still works (every
   * pre-existing call site in this file omits it).
   */
  it('threads a supplied supabaseClient through to the embedding call', async () => {
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.02))
    const fakeClient = { marker: 'the-caller-client' }

    await handleRemember(
      { key: 'client-thread-key', value: 'value to embed', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
      undefined,
      undefined,
      fakeClient as never,
    )

    await flushMicrotasks()

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('value to embed', {
      supabaseClient: fakeClient,
      projectId: TEST_PROJECT,
    })
  })

  it('still embeds when no supabaseClient is passed (existing callers unchanged)', async () => {
    mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0.04))

    await handleRemember(
      { key: 'no-client-key', value: 'value to embed', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('value to embed', {
      supabaseClient: undefined,
      projectId: TEST_PROJECT,
    })
    const raw = readRow(dbPath, TEST_PROJECT, 'no-client-key')
    expect(JSON.parse(raw!.embedding!)).toEqual(new Array(1536).fill(0.04))
  })

  it('does not throw or crash the process when embedding generation fails', async () => {
    mockGenerateEmbedding.mockRejectedValue(new Error('network error'))

    await expect(
      handleRemember(
        { key: 'fail-embed-key', value: 'value', type: 'convention' },
        TEST_PROJECT,
        cache,
        null,
      ),
    ).resolves.toBeTruthy()

    await flushMicrotasks()
    // No assertion needed beyond "did not throw" — failure is logged and swallowed.
  })

  it('generates a real (non-null) embedding for a very long memory value via scheduleEmbeddingSync (Task A chunking-bug regression)', async () => {
    // Before the Task A fix, generateEmbedding silently returned null for any
    // value over OpenAI's ~8192-token limit; the memory was stored with no
    // embedding and dropped out of semantic recall with no error anywhere.
    // generateEmbedding is mocked at the module boundary here (this suite
    // covers the remember.ts plumbing, not chunking internals — those are
    // covered directly in embeddings.test.ts), so this asserts the write
    // path calls through with the full long plaintext and stores whatever
    // real vector generateEmbedding returns, unskipped, regardless of length.
    const fakeEmbedding = new Array(1536).fill(0.07)
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding)

    const longValue = 'word '.repeat(12000)
    await handleRemember(
      { key: 'long-embed-key', value: longValue, type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(longValue, expect.objectContaining({ projectId: TEST_PROJECT }))
    const raw = readRow(dbPath, TEST_PROJECT, 'long-embed-key')
    expect(raw).not.toBeUndefined()
    expect(JSON.parse(raw!.embedding!)).toEqual(fakeEmbedding)
  })

  it('skips embedding storage entirely when no provider is available (returns null)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)

    await handleRemember(
      { key: 'no-provider-key', value: 'value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()
    expect(mockGenerateEmbedding).toHaveBeenCalled()
    // No error thrown; memory is still stored without an embedding.
    const stored = cache.getByKey(TEST_PROJECT, 'no-provider-key')
    expect(stored).not.toBeNull()
  })
})

/**
 * Regression tests for the delayed-embedding-write races (review findings 1-3).
 *
 * The embedding sync resolves seconds after the write. Before the fix it did a
 * FULL-ROW upsert of the stale captured Memory, which could (1) revert a newer
 * concurrent value, (2) resurrect a deleted row, and (3) clear a dirty flag set
 * by a newer update. The fix makes the late write a narrow, embedding-only,
 * serialized (projectId, key)-keyed update. These tests drive each race by
 * controlling exactly when the first write's embedding resolves.
 */
describe('delayed-embedding-write race safety (findings 1-3)', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-embed-race-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
    mockGenerateEmbedding.mockReset()
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('(a) V1-write -> V2-write -> V1-embedding-resolves leaves value=V2 (no revert / data loss)', async () => {
    const embV1 = new Array(1536).fill(0.11)
    let resolveV1!: (v: number[] | null) => void
    const v1Pending = new Promise<number[] | null>((r) => { resolveV1 = r })
    mockGenerateEmbedding
      .mockReturnValueOnce(v1Pending)      // V1 write: embedding still in flight
      .mockResolvedValueOnce(null)         // V2 write: no embedding, keeps test focused

    await handleRemember({ key: 'race-key', value: 'V1', type: 'convention' }, TEST_PROJECT, cache, null)
    await handleRemember({ key: 'race-key', value: 'V2', type: 'convention' }, TEST_PROJECT, cache, null)

    // Sanity: current stored value is V2 before the stale embedding lands.
    expect(cache.getByKey(TEST_PROJECT, 'race-key')!.value).toBe('V2')

    // Now the V1 embedding resolves LATE.
    resolveV1(embV1)
    await flushMicrotasks()

    // Value must remain V2 — the embedding-only update never rewrites value.
    expect(cache.getByKey(TEST_PROJECT, 'race-key')!.value).toBe('V2')
    // The embedding still lands on the current row (value untouched).
    const raw = readRow(dbPath, TEST_PROJECT, 'race-key')
    expect(JSON.parse(raw!.embedding!)).toEqual(embV1)
  })

  it('(b) write -> forget -> embedding-resolves leaves the memory DELETED (no resurrection)', async () => {
    const emb = new Array(1536).fill(0.22)
    let resolveEmb!: (v: number[] | null) => void
    const pending = new Promise<number[] | null>((r) => { resolveEmb = r })
    mockGenerateEmbedding.mockReturnValueOnce(pending)

    const sync = makeMockSync()
    await handleRemember({ key: 'gone-key', value: 'V', type: 'convention' }, TEST_PROJECT, cache, sync as unknown as SupabaseSync)
    expect(cache.getByKey(TEST_PROJECT, 'gone-key')).not.toBeNull()
    expect(sync.remoteStore.has('gone-key')).toBe(true)

    // Delete happens before the embedding resolves.
    await handleForget({ key: 'gone-key' }, TEST_PROJECT, cache, sync as unknown as SupabaseSync)
    expect(cache.getByKey(TEST_PROJECT, 'gone-key')).toBeNull()
    expect(sync.remoteStore.has('gone-key')).toBe(false)

    // Late embedding must NOT recreate the row, locally or remotely.
    resolveEmb(emb)
    await flushMicrotasks()

    expect(cache.getByKey(TEST_PROJECT, 'gone-key')).toBeNull()
    expect(readRow(dbPath, TEST_PROJECT, 'gone-key')).toBeUndefined()
    expect(sync.remoteStore.has('gone-key')).toBe(false)
  })

  it('(c) embedding write does not clear a dirty flag left by a newer update', async () => {
    const embV1 = new Array(1536).fill(0.33)
    let resolveV1!: (v: number[] | null) => void
    const v1Pending = new Promise<number[] | null>((r) => { resolveV1 = r })
    mockGenerateEmbedding
      .mockReturnValueOnce(v1Pending)      // V1 write: embedding in flight
      .mockResolvedValueOnce(null)         // V2 write: no embedding

    const sync = makeMockSync()

    // V1 write syncs cleanly -> dirty cleared.
    await handleRemember({ key: 'dirty-key', value: 'V1', type: 'convention' }, TEST_PROJECT, cache, sync as unknown as SupabaseSync)
    expect(readRow(dbPath, TEST_PROJECT, 'dirty-key')!.dirty).toBe(0)

    // V2 write's remote push fails, so it stays dirty and needs a later flush.
    sync.remoteInsert.mockResolvedValueOnce(false)
    await handleRemember({ key: 'dirty-key', value: 'V2', type: 'convention' }, TEST_PROJECT, cache, sync as unknown as SupabaseSync)
    expect(readRow(dbPath, TEST_PROJECT, 'dirty-key')!.dirty).toBe(1)

    // Late V1 embedding resolves. It must NOT markSynced / clear V2's dirty flag.
    resolveV1(embV1)
    await flushMicrotasks()

    expect(sync.markSynced).not.toHaveBeenCalled()
    expect(readRow(dbPath, TEST_PROJECT, 'dirty-key')!.dirty).toBe(1)
  })
})
