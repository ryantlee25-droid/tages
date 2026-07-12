import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
  TEST_LOCAL_CONFIG,
} from './helpers.js'

// vi.mock factories are hoisted — do NOT reference outer variables inside them.
// Use vi.hoisted() to share mocks across the factory and tests.
const {
  mockUpsertMemory,
  mockUpsertMemoryWithEmbedding,
  mockUpsertChunks,
  mockGetByKey,
  mockFlush,
  mockClose,
  mockOpenCliSync,
  mockGenerateEmbedding,
  mockGenerateChunkEmbeddings,
} = vi.hoisted(() => {
  const mockUpsertMemory = vi.fn()
  const mockUpsertMemoryWithEmbedding = vi.fn()
  const mockUpsertChunks = vi.fn()
  // Default: no persisted row found — preserves the memory.id fallback the
  // pre-existing (chunk-less) tests exercise. Overridden per-test.
  const mockGetByKey = vi.fn().mockReturnValue(null)
  const mockFlush = vi.fn().mockResolvedValue(undefined)
  const mockClose = vi.fn()
  const mockOpenCliSync = vi.fn().mockResolvedValue({
    cache: {
      upsertMemory: mockUpsertMemory,
      upsertMemoryWithEmbedding: mockUpsertMemoryWithEmbedding,
      upsertChunks: mockUpsertChunks,
      getByKey: mockGetByKey,
    },
    flush: mockFlush,
    close: mockClose,
  })
  // Default: no embedding provider available (returns null) — preserves the
  // trigram-only behaviour the pre-existing tests assert. Overridden per-test.
  const mockGenerateEmbedding = vi.fn().mockResolvedValue(null)
  // Default: no chunk provider available (returns null) — preserves existing
  // (chunk-less) behaviour; the caller's try/catch also tolerates this being
  // entirely absent (see the module factory below), but an explicit mock
  // lets chunk-path tests control it directly. Overridden per-test.
  const mockGenerateChunkEmbeddings = vi.fn().mockResolvedValue(null)
  return {
    mockUpsertMemory,
    mockUpsertMemoryWithEmbedding,
    mockUpsertChunks,
    mockGetByKey,
    mockFlush,
    mockClose,
    mockOpenCliSync,
    mockGenerateEmbedding,
    mockGenerateChunkEmbeddings,
  }
})

vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: mockOpenCliSync,
}))

vi.mock('../lib/embedding.js', () => ({
  generateEmbedding: mockGenerateEmbedding,
  generateChunkEmbeddings: mockGenerateChunkEmbeddings,
}))

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import { rememberCommand } from '../commands/remember.js'

describe('remember command', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    // Reset mock return values after clearAllMocks
    mockFlush.mockResolvedValue(undefined)
    mockGenerateEmbedding.mockResolvedValue(null)
    mockGenerateChunkEmbeddings.mockResolvedValue(null)
    mockGetByKey.mockReturnValue(null)
    mockOpenCliSync.mockResolvedValue({
      cache: {
        upsertMemory: mockUpsertMemory,
        upsertMemoryWithEmbedding: mockUpsertMemoryWithEmbedding,
        upsertChunks: mockUpsertChunks,
        getByKey: mockGetByKey,
      },
      flush: mockFlush,
      close: mockClose,
    })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('writes SQLite first then flushes to cloud', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const callOrder: string[] = []
    mockUpsertMemory.mockImplementation(() => { callOrder.push('sqlite') })
    mockFlush.mockImplementation(async () => { callOrder.push('flush') })

    await rememberCommand('test-key', 'test-value', { type: 'convention' })

    expect(callOrder).toEqual(['sqlite', 'flush'])
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
        projectId: 'test-project-id',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('test-key')
  })

  it('stores a memory and prints success message', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('test-key', 'test-value', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
        projectId: 'test-project-id',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('test-key')
  })

  it('stores a memory with optional tags and file paths', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('tagged-key', 'tagged-value', {
      type: 'decision',
      filePaths: ['src/index.ts', 'src/utils.ts'],
      tags: ['important', 'architecture'],
    })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tagged-key',
        value: 'tagged-value',
        type: 'decision',
        filePaths: ['src/index.ts', 'src/utils.ts'],
        tags: ['important', 'architecture'],
      }),
      true,
    )
  })

  it('handles special characters in value (quotes, newlines, unicode)', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const specialValue = 'He said "hello"\nNew line here\tTab\u00e9\u00e8\u00ea emoji: \u2764'
    await rememberCommand('special-chars', specialValue, { type: 'lesson' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'special-chars',
        value: specialValue,
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('special-chars')
  })

  it('exits with error when no project is configured', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      rememberCommand('key', 'value', { type: 'convention' }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain('No project configured')
    exitSpy.mockRestore()
  })

  it('Supabase failure does not prevent SQLite write', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    const callOrder: string[] = []
    mockUpsertMemory.mockImplementation(() => { callOrder.push('sqlite') })
    // flush throws — but SQLite was already written before flush is called
    mockFlush.mockImplementation(async () => {
      callOrder.push('flush-start')
      throw new Error('Network error')
    })

    // Command may throw from flush — but SQLite was written before that
    try {
      await rememberCommand('key', 'value', { type: 'convention' })
    } catch {
      // acceptable
    }

    expect(callOrder[0]).toBe('sqlite')
    expect(callOrder[1]).toBe('flush-start')
    expect(mockUpsertMemory).toHaveBeenCalled()
    // close() is always called in finally
    expect(mockClose).toHaveBeenCalled()
  })

  it('remember works in local mode (no supabaseUrl)', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await rememberCommand('local-key', 'local-value', { type: 'convention' })

    // openCliSync is called (handles local mode internally with no-op flush)
    expect(mockOpenCliSync).toHaveBeenCalled()
    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'local-key',
        value: 'local-value',
      }),
      true,
    )
    expect(console_.logs.join('\n')).toContain('local-key')
  })

  it('skips Supabase when in local-only mode (no supabaseUrl)', async () => {
    writeProjectConfig(tempConfigDir, TEST_LOCAL_CONFIG)

    await rememberCommand('local-key', 'local-value', { type: 'convention' })

    expect(mockOpenCliSync).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseUrl: '' }),
    )
    expect(console_.logs.join('\n')).toContain('local-key')
  })

  it('uses the specified project slug to load config', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG, slug: 'my-app' })

    await rememberCommand('key', 'val', { type: 'convention', project: 'my-app' })

    expect(console_.logs.join('\n')).toContain('key')
  })

  it('defaults type to convention', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('key', 'val', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'convention' }),
      true,
    )
  })

  it('defaults filePaths and tags to empty arrays when not provided', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)

    await rememberCommand('key', 'val', { type: 'convention' })

    expect(mockUpsertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        filePaths: [],
        tags: [],
      }),
      true,
    )
  })

  it('always calls close() even when flush throws', async () => {
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    mockFlush.mockRejectedValue(new Error('flush error'))

    try {
      await rememberCommand('key', 'value', { type: 'convention' })
    } catch {
      // may throw from flush
    }

    expect(mockClose).toHaveBeenCalled()
  })

  // Regression guard for the CLI silent-embedding bug: `tages remember` never
  // generated an embedding, so every CLI-stored memory had embedding=null and
  // was invisible to semantic recall (silent trigram-only fallback).
  describe('durable embedding generation', () => {
    it('persists via upsertMemoryWithEmbedding when generateEmbedding returns a vector', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      const vector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 0.42 : 0))
      mockGenerateEmbedding.mockResolvedValue(vector)

      await rememberCommand('stripe-key', 'We switched payment provider to Stripe', {
        type: 'decision',
      })

      // Embedded synchronously from the value (mirrors server plaintextForIndex).
      expect(mockGenerateEmbedding).toHaveBeenCalledWith('We switched payment provider to Stripe')

      // Durable persist path: embedding stored + marked dirty for sync.
      expect(mockUpsertMemoryWithEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'stripe-key',
          value: 'We switched payment provider to Stripe',
          type: 'decision',
          projectId: 'test-project-id',
        }),
        vector,
        true,
      )
      // The plain (embedding-less) path must NOT be used when we have a vector.
      expect(mockUpsertMemory).not.toHaveBeenCalled()
      // Cloud sync still runs.
      expect(mockFlush).toHaveBeenCalled()
    })

    it('falls back to plain upsertMemory when generateEmbedding returns null (no regression)', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      mockGenerateEmbedding.mockResolvedValue(null)

      await rememberCommand('no-embed-key', 'no-embed-value', { type: 'convention' })

      expect(mockUpsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'no-embed-key', value: 'no-embed-value' }),
        true,
      )
      expect(mockUpsertMemoryWithEmbedding).not.toHaveBeenCalled()
      expect(console_.logs.join('\n')).toContain('no-embed-key')
    })

    it('does not crash when generateEmbedding rejects — memory still stored via plain path', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      // A real throw (network error, Ollama down mid-request, provider 5xx): the
      // command must NOT crash and must fall back to the plain upsert path so the
      // memory is never lost. mockRejectedValue (not mockResolvedValue(null)) is
      // what actually exercises the try/catch guard.
      mockGenerateEmbedding.mockRejectedValue(new Error('embedding provider down'))

      await expect(
        rememberCommand('robust-key', 'robust-value', { type: 'convention' }),
      ).resolves.toBeUndefined()

      // Fell back to the plain (embedding-less) store — memory preserved.
      expect(mockUpsertMemory).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'robust-key', value: 'robust-value' }),
        true,
      )
      // The embedding path must NOT have been used when generation threw.
      expect(mockUpsertMemoryWithEmbedding).not.toHaveBeenCalled()
      // Memory still confirmed stored to the user.
      expect(console_.logs.join('\n')).toContain('robust-key')
    })
  })

  // Chunk-sync key-resolution path (Task 9 Phase 2): `remember.ts` resolves
  // the chunk rows' parent id via `cache.getByKey` rather than trusting the
  // locally-generated `memory.id`, because `upsertMemory`'s
  // ON CONFLICT(project_id, key) DO UPDATE keeps the EXISTING row's id on a
  // re-remember of an existing key. Same id-divergence bug class documented
  // in supabase-sync.ts (caught live on the dev eval: chunks stranded local-
  // only because they were keyed on a local id the remote row didn't share).
  describe('chunk write path — persisted?.id ?? memory.id resolution', () => {
    it('re-remember of an existing key: chunks are keyed on the PERSISTED row id, not the fresh local memory.id', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      const chunks = [{ text: 'chunk one', embedding: [0.1, 0.2] }]
      mockGenerateChunkEmbeddings.mockResolvedValue({ pooled: [0.1, 0.2], chunks })
      // Simulates ON CONFLICT DO UPDATE: the existing row keeps its own,
      // different id from the fresh randomUUID() generated for this call.
      mockGetByKey.mockReturnValue({ id: 'existing-persisted-id', key: 'stripe-key' })

      await rememberCommand('stripe-key', 'We switched payment provider to Stripe', {
        type: 'decision',
      })

      expect(mockGetByKey).toHaveBeenCalledWith('test-project-id', 'stripe-key')
      // Keyed on the persisted row's id — never the throwaway fresh local id
      // generated for this call (upsertChunks called exactly once, with the
      // persisted id as its sole first-argument value).
      expect(mockUpsertChunks).toHaveBeenCalledTimes(1)
      expect(mockUpsertChunks).toHaveBeenCalledWith('existing-persisted-id', 'test-project-id', chunks)
    })

    it('brand-new key: falls back to the local memory.id when getByKey finds nothing yet', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      const chunks = [{ text: 'chunk one', embedding: [0.3, 0.4] }]
      mockGenerateChunkEmbeddings.mockResolvedValue({ pooled: [0.3, 0.4], chunks })
      mockGetByKey.mockReturnValue(null)

      await rememberCommand('brand-new-key', 'a brand new fact', { type: 'convention' })

      expect(mockUpsertChunks).toHaveBeenCalledTimes(1)
      const [calledId, calledProjectId, calledChunks] = mockUpsertChunks.mock.calls[0]
      expect(typeof calledId).toBe('string')
      expect(calledId).not.toBe('') // falls back to memory.id (a fresh randomUUID), never empty/undefined
      expect(calledProjectId).toBe('test-project-id')
      expect(calledChunks).toEqual(chunks)
    })

    it('does not call upsertChunks at all when generateChunkEmbeddings returns null (no chunk provider)', async () => {
      writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
      mockGenerateChunkEmbeddings.mockResolvedValue(null)

      await rememberCommand('no-chunk-key', 'no-chunk-value', { type: 'convention' })

      expect(mockUpsertChunks).not.toHaveBeenCalled()
      // getByKey is only needed to resolve a chunk parent id — must not be
      // called when there are no chunks to persist.
      expect(mockGetByKey).not.toHaveBeenCalled()
    })
  })
})

// End-to-end sync-payload guard using the REAL server cache + serializer.
// Proves the embedding a durable remember writes locally actually reaches the
// Supabase upsert payload: upsertMemoryWithEmbedding -> getDirty()/rowToMemory
// (must reconstruct memory.embedding from the SQLite TEXT column) ->
// memoryToDbRow (must serialize it to pgvector). This is the link that was
// silently broken: rowToMemory dropped the embedding, so flush() never sent it.
describe('embedding reaches the Supabase flush payload (real round-trip)', () => {
  it('getDirty()->memoryToDbRow carries the embedding as pgvector', async () => {
    const os = await import('os')
    const fs = await import('fs')
    const pathMod = await import('path')
    // @ts-ignore — cross-package source import (same pattern as agents-md.test.ts)
    const { SqliteCache } = await import('../../../server/src/cache/sqlite.js')
    const { memoryToDbRow, embeddingToPgVector } = await import(
      // @ts-ignore — cross-package source import
      '../../../server/src/sync/supabase-sync.js'
    )

    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'tages-remember-embed-'))
    const dbPath = pathMod.join(dir, 'roundtrip.db')
    const cache = new SqliteCache(dbPath)
    try {
      const vector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 0.7 : 0))
      const now = new Date().toISOString()
      const memory = {
        id: 'rt-id-1',
        projectId: 'rt-project',
        key: 'payment-provider',
        value: 'We switched payment provider to Stripe',
        type: 'decision' as const,
        source: 'manual' as const,
        status: 'live' as const,
        filePaths: [],
        tags: [],
        confidence: 1.0,
        createdAt: now,
        updatedAt: now,
      }

      // Durable-remember local write.
      cache.upsertMemoryWithEmbedding(memory, vector, true)

      // What flush() would send to Supabase.
      const dirty = cache.getDirty()
      expect(dirty).toHaveLength(1)
      expect(dirty[0].embedding).toEqual(vector)

      const row = memoryToDbRow(dirty[0])
      expect(row.embedding).toBe(embeddingToPgVector(vector))
    } finally {
      cache.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
