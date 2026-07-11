/**
 * Fix 4 (finding 4): in handleRecall's remote-hybrid branch, decryptMemories
 * must run BEFORE rerankMemories, so the cross-encoder scores PLAINTEXT values
 * — not opaque `enc:v1:...` ciphertext. Previously decryption ran only after
 * rerank + temporal reorder, so an encrypted-at-rest project reranked on
 * ciphertext and produced meaningless relevance ordering.
 *
 * We mock the embedder (to force the remote branch) and the reranker (to
 * capture exactly what it receives) — reranker.ts itself is untouched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Memory } from '@tages/shared'
import { encryptValue, getEncryptionKey } from '../crypto/encryption'

const VALID_KEY_HEX = 'd'.repeat(64)

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(async () => new Array(1536).fill(0.1)),
}))

// Capture what rerankMemories receives. Identity reorder (returns input as-is).
const rerankInputs: Memory[][] = []
vi.mock('../search/reranker', () => ({
  rerankMemories: vi.fn(async (memories: Memory[]) => {
    rerankInputs.push(memories)
    return memories
  }),
}))

import { handleRecall } from '../tools/recall'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

function makeMemory(value: string): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    projectId: 'proj-1',
    key: 'stripe-config',
    value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1,
    filePaths: [],
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    encrypted: true,
  }
}

describe('Fix 4: handleRecall decrypts candidates before rerank (remote-hybrid branch)', () => {
  beforeEach(() => {
    rerankInputs.length = 0
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
  })

  afterEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('passes PLAINTEXT (not ciphertext) values into rerankMemories', async () => {
    const key = getEncryptionKey()!
    const plaintext = 'Stripe secret key lives in the server env, never client'
    const encrypted = encryptValue(plaintext, key)
    // Sanity: the stored value is genuinely ciphertext.
    expect(encrypted).toMatch(/^enc:v1:/)

    const encryptedMemory = makeMemory(encrypted)

    // Empty local cache => handleRecall falls through to the remote branch.
    const cache = {
      scoredQuery: vi.fn(() => []),
      updateAccessTime: vi.fn(),
      getAccessInfo: vi.fn(() => null),
      queryMemories: vi.fn(() => []),
    } as unknown as SqliteCache

    const sync = {
      remoteHybridRecall: vi.fn(async () => [encryptedMemory]),
      remoteChunkSemanticRecall: vi.fn(async () => []),
      remoteRecall: vi.fn(async () => null),
    } as unknown as SupabaseSync

    const result = await handleRecall(
      { query: 'where is the stripe secret' },
      'proj-1',
      cache,
      sync,
    )

    // rerankMemories was handed the DECRYPTED value, not the ciphertext.
    expect(rerankInputs).toHaveLength(1)
    expect(rerankInputs[0]).toHaveLength(1)
    expect(rerankInputs[0][0].value).toBe(plaintext)
    expect(rerankInputs[0][0].value).not.toMatch(/^enc:v1:/)

    // And the final response surfaces the plaintext (double-decrypt safe).
    expect(result.content[0].text).toContain(plaintext)
  })
})
