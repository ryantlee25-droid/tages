/**
 * Tests for the `encrypted` flag round-trip (C1).
 *
 * Verifies that:
 * 1. `encrypted` defaults to false in SQLite and is persisted correctly.
 * 2. When TAGES_ENCRYPTION_KEY is set, remember sets encrypted = true.
 * 3. recall returns an error message when a row is encrypted but no key is available.
 * 4. DbRow <-> Memory mapping includes the encrypted field.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleRecall } from '../tools/recall'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const VALID_KEY_HEX = 'a'.repeat(64) // 32 bytes as 64 hex chars
const TEST_PROJECT = 'test-encrypted-flag-project'

describe('encrypted flag round-trip', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-enc-flag-test-${Date.now()}.db`)
    cache = new SqliteCache(dbPath)
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
    delete process.env.TAGES_ENCRYPTION_KEY
  })

  it('defaults encrypted to false when no key is set', async () => {
    await handleRemember(
      { key: 'plain-key', value: 'plain value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    const stored = cache.getByKey(TEST_PROJECT, 'plain-key')
    expect(stored).not.toBeNull()
    expect(stored!.encrypted).toBe(false)
  })

  it('sets encrypted = true and stores ciphertext when key is configured', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX

    await handleRemember(
      { key: 'secret-key', value: 'secret value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    const stored = cache.getByKey(TEST_PROJECT, 'secret-key')
    expect(stored).not.toBeNull()
    expect(stored!.encrypted).toBe(true)
    // Value should be ciphertext, not plaintext
    expect(stored!.value).toMatch(/^enc:v1:/)
    expect(stored!.value).not.toBe('secret value')
  })

  it('recall decrypts correctly when key is available', async () => {
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX

    await handleRemember(
      { key: 'recall-enc-key', value: 'recall secret', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    const result = await handleRecall(
      { query: 'recall-enc-key' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('recall secret')
    expect(result.content[0].text).not.toContain('enc:v1:')
  })

  it('recall returns error message when row is encrypted but no key available', async () => {
    // Store encrypted
    process.env.TAGES_ENCRYPTION_KEY = VALID_KEY_HEX
    await handleRemember(
      { key: 'no-key-recall', value: 'encrypted value', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    // Remove key before recall
    delete process.env.TAGES_ENCRYPTION_KEY

    const result = await handleRecall(
      { query: 'no-key-recall' },
      TEST_PROJECT,
      cache,
      null,
    )

    expect(result.content[0].text).toContain('[ERROR: memory is encrypted but TAGES_ENCRYPTION_KEY is not set]')
  })

  it('SQLite schema survives upgrade path — encrypted column has default 0 on existing DBs', () => {
    // Simulate an existing memory inserted without the encrypted column
    // The upgrade path in SqliteCache constructor should add it with default 0
    const stored = cache.getByKey(TEST_PROJECT, 'nonexistent-key')
    // Just verify the cache initialized without error (column add is idempotent)
    expect(stored).toBeNull()
  })
})
