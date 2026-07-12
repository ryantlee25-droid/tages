/**
 * Tests for Task 12: sandbox-scoped one-time chunk-embedding backfill.
 *
 * Mirrors backfill-embeddings.test.ts's structure and mocking style, adapted
 * for backfillChunkEmbeddings' different candidate shape (a `memory_chunks`
 * existence check per row, rather than a single `embedding IS NULL` filter):
 *   - dry-run mode reports a count of long, not-yet-chunked memories and writes nothing
 *   - a real run generates + writes chunk rows for long candidate memories
 *   - a memory that already has chunk rows is skipped (idempotent)
 *   - a memory at/under the chunking threshold is left alone entirely
 *   - plaintext/ciphertext is never logged (only ids and error messages)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backfillChunkEmbeddings } from './backfill-chunk-embeddings'
import { CHUNK_TARGET_CHARS } from '../src/chunking'

vi.mock('../src/embeddings', () => ({
  generateChunkEmbeddings: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { generateChunkEmbeddings } from '../src/embeddings'
const mockGenerateChunkEmbeddings = vi.mocked(generateChunkEmbeddings)

interface FakeMemoryRow {
  id: string
  key?: string
  value: string
  encrypted: boolean
}

const LONG_VALUE = 'lorem ipsum dolor sit amet '.repeat(300) // well over CHUNK_TARGET_CHARS
const SHORT_VALUE = 'a short memory value'

function makeSupabaseMock(memories: FakeMemoryRow[], chunkCounts: Record<string, number> = {}) {
  const chunkDeletes: string[] = []
  const chunkInserts: Array<{ memoryId: string; rows: unknown[] }> = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function memoriesTable(): any {
    const filters: Array<[string, unknown]> = []
    const builder = {
      eq: vi.fn((col: string, val: unknown) => {
        filters.push([col, val])
        return builder
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        return Promise.resolve({ data: memories.slice(start, end + 1), error: null })
      }),
      maybeSingle: vi.fn(() => {
        // remoteUpsertChunks resolves the parent by (project_id, key)
        const keyFilter = filters.find(([c]) => c === 'key')
        const idFilter = filters.find(([c]) => c === 'id')
        const found = keyFilter
          ? memories.find((m) => (m.key ?? m.id) === keyFilter[1])
          : idFilter
            ? memories.find((m) => m.id === idFilter[1])
            : undefined
        return Promise.resolve({ data: found ? { id: found.id } : null, error: null })
      }),
    }
    return { select: vi.fn(() => builder) }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function memoryChunksTable(): any {
    return {
      select: vi.fn(() => {
        let matchedId = ''
        const builder = {
          eq: vi.fn((_col: string, id: string) => {
            matchedId = id
            return builder
          }),
          then: (resolve: (v: { count: number; error: null }) => void) => {
            resolve({ count: chunkCounts[matchedId] ?? 0, error: null })
          },
        }
        return builder
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, id: string) => {
          chunkDeletes.push(id)
          return Promise.resolve({ error: null })
        }),
      })),
      insert: vi.fn((rows: Array<{ memory_id: string }>) => {
        chunkInserts.push({ memoryId: rows[0]?.memory_id, rows })
        return Promise.resolve({ error: null })
      }),
    }
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'memories') return memoriesTable()
      if (table === 'memory_chunks') return memoryChunksTable()
      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, chunkDeletes, chunkInserts }
}

describe('backfillChunkEmbeddings', () => {
  beforeEach(() => {
    mockGenerateChunkEmbeddings.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dry run reports the count of long, not-yet-chunked memories and writes nothing', async () => {
    const { supabase, chunkInserts } = makeSupabaseMock([
      { id: 'long-a', key: 'long-a', value: LONG_VALUE, encrypted: false },
      { id: 'long-b', key: 'long-b', value: LONG_VALUE, encrypted: false },
      { id: 'short-a', key: 'short-a', value: SHORT_VALUE, encrypted: false },
    ])

    const result = await backfillChunkEmbeddings(supabase, 'proj-1', { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.totalRemaining).toBe(2) // only the two long memories count
    expect(result.updated).toBe(0)
    expect(chunkInserts).toHaveLength(0)
    expect(mockGenerateChunkEmbeddings).not.toHaveBeenCalled()
  })

  it('dry run excludes long memories that already have chunk rows', async () => {
    const { supabase } = makeSupabaseMock(
      [{ id: 'long-a', key: 'long-a', value: LONG_VALUE, encrypted: false }],
      { 'long-a': 3 },
    )

    const result = await backfillChunkEmbeddings(supabase, 'proj-1', { dryRun: true })

    expect(result.totalRemaining).toBe(0)
  })

  it('generates and writes chunk rows for long candidate memories', async () => {
    const { supabase, chunkInserts, chunkDeletes } = makeSupabaseMock([
      { id: 'long-a', key: 'long-a', value: LONG_VALUE, encrypted: false },
    ])
    mockGenerateChunkEmbeddings.mockResolvedValue({
      pooled: new Array(1536).fill(0.1),
      chunks: [
        { text: 'chunk 1', embedding: new Array(1536).fill(0.1) },
        { text: 'chunk 2', embedding: new Array(1536).fill(0.2) },
      ],
    })

    const result = await backfillChunkEmbeddings(supabase, 'proj-1', { batchSize: 10 })

    expect(result.processed).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)
    expect(chunkDeletes).toEqual(['long-a'])
    expect(chunkInserts).toHaveLength(1)
    expect(chunkInserts[0].rows).toHaveLength(2)
  })

  it('skips a memory that already has chunk rows (idempotent)', async () => {
    const { supabase, chunkInserts } = makeSupabaseMock(
      [{ id: 'long-a', key: 'long-a', value: LONG_VALUE, encrypted: false }],
      { 'long-a': 2 },
    )

    const result = await backfillChunkEmbeddings(supabase, 'proj-1')

    expect(result.processed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.updated).toBe(0)
    expect(chunkInserts).toHaveLength(0)
    expect(mockGenerateChunkEmbeddings).not.toHaveBeenCalled()
  })

  it('leaves short memories (at/under the chunking threshold) completely untouched', async () => {
    const atThreshold = 'x'.repeat(CHUNK_TARGET_CHARS)
    const { supabase, chunkInserts } = makeSupabaseMock([
      { id: 'short-a', key: 'short-a', value: SHORT_VALUE, encrypted: false },
      { id: 'at-threshold', value: atThreshold, encrypted: false },
    ])

    const result = await backfillChunkEmbeddings(supabase, 'proj-1')

    expect(result.processed).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.updated).toBe(0)
    expect(chunkInserts).toHaveLength(0)
    expect(mockGenerateChunkEmbeddings).not.toHaveBeenCalled()
  })

  it('marks a row failed (not crashing the batch) when chunk embedding generation is unavailable', async () => {
    const { supabase, chunkInserts } = makeSupabaseMock([
      { id: 'long-a', key: 'long-a', value: LONG_VALUE, encrypted: false },
    ])
    mockGenerateChunkEmbeddings.mockResolvedValue(null)

    const result = await backfillChunkEmbeddings(supabase, 'proj-1')

    expect(result.processed).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.failed).toBe(1)
    expect(chunkInserts).toHaveLength(0)
  })

  it('never logs plaintext or ciphertext, only ids and error messages', async () => {
    const sensitiveValue = `super secret plaintext content ${'x'.repeat(CHUNK_TARGET_CHARS)}`
    const { supabase } = makeSupabaseMock([
      { id: 'sensitive-row-id', value: sensitiveValue, encrypted: false },
    ])
    mockGenerateChunkEmbeddings.mockRejectedValue(new Error('provider exploded'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await backfillChunkEmbeddings(supabase, 'proj-1')

    const loggedText = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(loggedText).toContain('sensitive-row-id')
    expect(loggedText).not.toContain('super secret plaintext content')
    errorSpy.mockRestore()
  })
})
