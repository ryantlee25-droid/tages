/**
 * Task 1c: decryption failure must be isolated to the offending ROW, not the
 * whole recall response.
 *
 * `decryptMemories` (packages/server/src/tools/recall.ts) calls decryptValue
 * per memory. decryptValue throws (crypto/encryption.ts — the auth-tag length
 * guard and decipher.final()) whenever the configured key cannot open that
 * row's ciphertext. That is the routine state the moment two developers share
 * a project with different TAGES_ENCRYPTION_KEY values, since Tages ships no
 * key-distribution mechanism. Before the fix there was no try/catch here and
 * none at the call site in index.ts, so ONE bad row threw away every good row
 * in the response.
 *
 * These tests drive the real handleRecall (local-cache branch) rather than
 * poking decryptMemories directly, since decryptMemories is module-private —
 * that also proves nothing escapes to the MCP client. The embedder is mocked
 * to keep the test offline, matching recall-decrypt-before-rerank.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Memory } from '@tages/shared'
import { encryptValue, getEncryptionKey } from '../crypto/encryption'

const VALID_KEY_HEX = 'd'.repeat(64)
const OTHER_KEY_HEX = 'b'.repeat(64)

const NO_KEY_PLACEHOLDER = '[ERROR: memory is encrypted but TAGES_ENCRYPTION_KEY is not set]'
const BAD_ROW_PLACEHOLDER = '[ERROR: memory could not be decrypted with the configured TAGES_ENCRYPTION_KEY]'

vi.mock('../embeddings', () => ({
  generateEmbedding: vi.fn(async () => new Array(1536).fill(0.1)),
}))

import { handleRecall } from '../tools/recall'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

function makeMemory(id: string, key: string, value: string): Memory {
  return {
    id,
    projectId: 'proj-1',
    key,
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

// Warm local cache => handleRecall takes the `scoredResults.length > 0`
// branch, which calls decryptMemories on the sliced ranked list.
function makeCache(memories: Memory[]): SqliteCache {
  return {
    scoredQuery: vi.fn(() => memories.map(memory => ({ memory, semanticScore: 0.9, textScore: 0.9 }))),
    updateAccessTime: vi.fn(),
    getAccessInfo: vi.fn(() => null),
    queryMemories: vi.fn(() => []),
  } as unknown as SqliteCache
}

const NO_SYNC: SupabaseSync | null = null

describe('decryptMemories: per-row decryption failure isolation', () => {
  beforeEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('keeps the good rows when one row has unparseable ciphertext', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    const key = getEncryptionKey()!

    const goodA = 'Pin @supabase/supabase-js exactly when using ssr'
    const goodB = 'Never use git add -A; stage files by name'

    const memories = [
      makeMemory('mem-a', 'supabase-pin', encryptValue(goodA, key)),
      // Truncated/corrupt blob: carries the enc:v1: prefix but decodes to far
      // fewer bytes than iv+authTag, so decryptValue throws.
      makeMemory('mem-bad', 'corrupt-row', 'enc:v1:zzzz'),
      makeMemory('mem-c', 'git-staging', encryptValue(goodB, key)),
    ]

    const result = await handleRecall(
      { query: 'conventions' },
      'proj-1',
      makeCache(memories),
      NO_SYNC,
    )

    const text = result.content[0].text

    // Same NUMBER of rows the response would have had without the bad row.
    expect(text).toContain('Found 3 memories')
    expect(text).toMatch(/\[3\]/)

    // The two healthy rows decrypted to their real plaintext.
    expect(text).toContain(goodA)
    expect(text).toContain(goodB)

    // The bad row is present, flagged, and not leaking raw ciphertext.
    expect(text).toContain(BAD_ROW_PLACEHOLDER)
    expect(text).not.toContain('enc:v1:zzzz')
  })

  it('yields the placeholder for a row encrypted with a DIFFERENT key instead of throwing', async () => {
    // Encrypt under key B...
    process.env.TAGES_ENCRYPTION_KEY = OTHER_KEY_HEX
    const otherKey = getEncryptionKey()!
    const foreign = encryptValue('written by a teammate with their own key', otherKey)
    expect(foreign).toMatch(/^enc:v1:/)

    // ...but recall under key A. Structurally valid ciphertext, wrong key:
    // decipher.final() fails the GCM auth tag.
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    const key = getEncryptionKey()!
    const mine = 'my own memory, decrypts fine'

    const memories = [
      makeMemory('mem-foreign', 'teammate-row', foreign),
      makeMemory('mem-mine', 'my-row', encryptValue(mine, key)),
    ]

    const result = await handleRecall(
      { query: 'conventions' },
      'proj-1',
      makeCache(memories),
      NO_SYNC,
    )

    const text = result.content[0].text
    expect(text).toContain('Found 2 memories')
    expect(text).toContain(BAD_ROW_PLACEHOLDER)
    expect(text).toContain(mine)
    expect(text).not.toContain(foreign)
  })

  it('leaves an unencrypted row untouched alongside a failing encrypted row', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX

    const plain = makeMemory('mem-plain', 'plain-row', 'stored before encryption was enabled')
    plain.encrypted = false

    const memories = [
      makeMemory('mem-bad', 'corrupt-row', 'enc:v1:zzzz'),
      plain,
    ]

    const result = await handleRecall(
      { query: 'conventions' },
      'proj-1',
      makeCache(memories),
      NO_SYNC,
    )

    const text = result.content[0].text
    expect(text).toContain('Found 2 memories')
    expect(text).toContain('stored before encryption was enabled')
    expect(text).toContain(BAD_ROW_PLACEHOLDER)
  })

  // Regression guard: the pre-existing "encrypted row, no key configured at
  // all" behavior is a DIFFERENT case and must keep its own placeholder.
  it('regression: still emits the no-key placeholder when TAGES_ENCRYPTION_KEY is unset', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    const key = getEncryptionKey()!
    const ciphertext = encryptValue('secret', key)
    delete process.env.TAGES_ENCRYPTION_KEY

    const memories = [makeMemory('mem-a', 'secret-row', ciphertext)]

    const result = await handleRecall(
      { query: 'conventions' },
      'proj-1',
      makeCache(memories),
      NO_SYNC,
    )

    const text = result.content[0].text
    expect(text).toContain('Found 1 memories')
    expect(text).toContain(NO_KEY_PLACEHOLDER)
    expect(text).not.toContain(BAD_ROW_PLACEHOLDER)
  })

  it('returns the unchanged MCP content shape even when a row fails to decrypt', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX

    const memories = [makeMemory('mem-bad', 'corrupt-row', 'enc:v1:zzzz')]

    const result = await handleRecall(
      { query: 'conventions' },
      'proj-1',
      makeCache(memories),
      NO_SYNC,
    )

    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(typeof result.content[0].text).toBe('string')
  })
})
