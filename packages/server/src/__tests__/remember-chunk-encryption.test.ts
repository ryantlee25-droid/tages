/**
 * Fix B (finding 3): chunk_text encryption at rest.
 *
 * When TAGES_ENCRYPTION_KEY is set, memories.value is encrypted at rest — but
 * the memory_chunks mirror was writing chunk_text VERBATIM (plaintext) both
 * locally and remotely, leaking the memory's content at rest. handleRemember's
 * chunk path must now encrypt chunk_text with the SAME field encryption as
 * memories.value, while still computing the chunk embedding from PLAINTEXT
 * (so semantic search is unaffected). These tests mock the embedders and prove
 * the round-trip: stored chunk_text is ciphertext, decrypts back to plaintext,
 * and the embedding is the plaintext-derived vector unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { decryptValue, getEncryptionKey } from '../crypto/encryption'
import type { SupabaseSync } from '../sync/supabase-sync'

const TEST_PROJECT = 'test-chunk-encryption-project'
const VALID_KEY_HEX = 'c'.repeat(64)

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(async () => null),
  generateChunkEmbeddings: vi.fn(),
}))

import { generateChunkEmbeddings } from '../embeddings'
const mockGenerateChunkEmbeddings = vi.mocked(generateChunkEmbeddings)

function readChunkRows(dbPath: string): Array<{ chunk_index: number; chunk_text: string; embedding: string | null }> {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.prepare(
      'SELECT chunk_index, chunk_text, embedding FROM memory_chunks ORDER BY chunk_index'
    ).all() as Array<{ chunk_index: number; chunk_text: string; embedding: string | null }>
  } finally {
    db.close()
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function makeChunkSync(): { remoteUpsertChunks: Mock; captured: Array<Array<{ text: string; embedding: number[] }>> } {
  const captured: Array<Array<{ text: string; embedding: number[] }>> = []
  const remoteUpsertChunks = vi.fn(async (_projectId: string, _key: string, chunks: Array<{ text: string; embedding: number[] }>) => {
    captured.push(chunks)
    return true
  })
  return { remoteUpsertChunks, captured }
}

describe('Fix B: chunk_text encryption at rest', () => {
  let cache: SqliteCache
  let dbPath: string

  const chunkA = 'first plaintext chunk with a secret'
  const chunkB = 'second plaintext chunk'
  const embA = new Array(1536).fill(0.11)
  const embB = new Array(1536).fill(0.22)

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-chunk-enc-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
    mockGenerateChunkEmbeddings.mockReset()
    mockGenerateChunkEmbeddings.mockResolvedValue({
      pooled: new Array(1536).fill(0.5),
      chunks: [
        { text: chunkA, embedding: embA },
        { text: chunkB, embedding: embB },
      ],
    })
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('encrypts chunk_text at rest (local + remote) and round-trips to plaintext, embedding unchanged', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    const { remoteUpsertChunks, captured } = makeChunkSync()

    await handleRemember(
      { key: 'enc-chunk-key', value: 'first plaintext chunk with a secret second plaintext chunk', type: 'convention' },
      TEST_PROJECT,
      cache,
      { remoteInsert: vi.fn(async () => true), remoteCountMemories: vi.fn(async () => 0), remoteUpdateEmbedding: vi.fn(async () => true), remoteUpsertChunks } as unknown as SupabaseSync,
    )

    await flushMicrotasks()

    // Local: chunk_text is ciphertext, not plaintext.
    const rows = readChunkRows(dbPath)
    expect(rows).toHaveLength(2)
    expect(rows[0].chunk_text).toMatch(/^enc:v1:/)
    expect(rows[1].chunk_text).toMatch(/^enc:v1:/)
    expect(rows[0].chunk_text).not.toContain('secret')

    // Decrypts back to the original plaintext.
    const key = getEncryptionKey()!
    expect(decryptValue(rows[0].chunk_text, key)).toBe(chunkA)
    expect(decryptValue(rows[1].chunk_text, key)).toBe(chunkB)

    // Embedding stored is the PLAINTEXT-derived vector, unchanged by encryption.
    expect(JSON.parse(rows[0].embedding!)).toEqual(embA)
    expect(JSON.parse(rows[1].embedding!)).toEqual(embB)

    // Remote also received ciphertext (never plaintext) at rest.
    expect(remoteUpsertChunks).toHaveBeenCalledTimes(1)
    expect(captured).toHaveLength(1)
    expect(captured[0][0].text).toMatch(/^enc:v1:/)
    expect(decryptValue(captured[0][0].text, key)).toBe(chunkA)
    // Remote embedding is still the plaintext-derived vector.
    expect(captured[0][0].embedding).toEqual(embA)
  })

  it('stores chunk_text as plaintext when no encryption key is configured (unchanged default)', async () => {
    // No TAGES_ENCRYPTION_KEY — matches the eval config (no encryption).
    await handleRemember(
      { key: 'plain-chunk-key', value: 'first plaintext chunk with a secret second plaintext chunk', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    await flushMicrotasks()

    const rows = readChunkRows(dbPath)
    expect(rows).toHaveLength(2)
    expect(rows[0].chunk_text).toBe(chunkA)
    expect(rows[1].chunk_text).toBe(chunkB)
    expect(JSON.parse(rows[0].embedding!)).toEqual(embA)
  })
})
