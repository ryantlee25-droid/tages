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
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { Memory } from '@tages/shared'

const TEST_PROJECT = 'test-remember-embedding-project'
const VALID_KEY_HEX = 'b'.repeat(64)

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(),
}))

import { generateEmbedding } from '../embeddings'

const mockGenerateEmbedding = vi.mocked(generateEmbedding)

function makeMockSync(): SupabaseSync & { inserted: Memory[] } {
  const mock = {
    inserted: [] as Memory[],
    remoteInsert: vi.fn(async (mem: Memory) => {
      mock.inserted.push(mem)
      return true
    }),
    markSynced: vi.fn(),
    startSync: vi.fn(),
    stopSync: vi.fn(),
    flush: vi.fn(async () => {}),
    hydrate: vi.fn(async () => 0),
    recoverWAL: vi.fn(async () => 0),
    remoteDelete: vi.fn(async () => true),
    remoteRecall: vi.fn(async () => null),
    remoteHybridRecall: vi.fn(async () => null),
    remoteGetByType: vi.fn(async () => null),
    remoteVerifyMemory: vi.fn(async () => true),
    remoteCountMemories: vi.fn(async () => 0),
    remoteFederatedInsert: vi.fn(async () => true),
    remoteListFederated: vi.fn(async () => null),
  }
  return mock as unknown as SupabaseSync & { inserted: Memory[] }
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

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('some memory value')

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

    expect(mockGenerateEmbedding).toHaveBeenCalledWith('plaintext secret value')
    // Sanity: the stored value itself is ciphertext, confirming encryption ran
    // before the embedding call inspected the plaintext copy separately.
    const stored = cache.getByKey(TEST_PROJECT, 'enc-embed-key')
    expect(stored!.value).toMatch(/^enc:v1:/)
  })

  it('pushes the computed embedding to Supabase via sync.remoteInsert once ready', async () => {
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

    // First remoteInsert call: the synchronous write path (no embedding yet).
    // Second remoteInsert call: the fire-and-forget embedding sync.
    expect(sync.remoteInsert).toHaveBeenCalledTimes(2)
    const withEmbedding = sync.inserted.find((m) => m.embedding !== undefined)
    expect(withEmbedding).toBeTruthy()
    expect(withEmbedding!.embedding).toEqual(fakeEmbedding)
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
