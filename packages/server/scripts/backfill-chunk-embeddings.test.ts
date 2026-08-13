/**
 * Tests for the full hosted re-embed of `memory_chunks`
 * (PLAN-HOSTED-EMBEDDING.md Task 4).
 *
 * The two behaviour changes this file pins down:
 *   - memories that ALREADY have chunk rows are re-chunked, not skipped
 *     (those chunks came from a different model, so they are stale, not done).
 *     `remoteUpsertChunks` deletes-then-inserts per memory, so this is
 *     idempotent without any new delete logic.
 *   - every memory is in scope, not just ones over the OpenAI-sized
 *     CHUNK_TARGET_CHARS. The write path (`remember.ts`) chunks every memory
 *     unconditionally; a 4000-char floor here would leave everything between
 *     the hosted chunk size and 4000 with chunk rows in one path and none in
 *     the other.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backfillChunkEmbeddings } from './backfill-chunk-embeddings'
import type { BackfillCheckpoint } from './backfill-embeddings'

vi.mock('../src/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/embeddings')>()
  return {
    ...actual,
    generateChunkEmbeddings: vi.fn(),
    resolveEmbeddingProvider: vi.fn(() => 'hosted'),
  }
})

import { generateChunkEmbeddings, resolveEmbeddingProvider, HOSTED_CHUNK_TARGET_CHARS } from '../src/embeddings'
import { CHUNK_TARGET_CHARS } from '../src/chunking'

const mockGenerateChunks = vi.mocked(generateChunkEmbeddings)
const mockResolveProvider = vi.mocked(resolveEmbeddingProvider)

const PROJECT = 'proj-1'

interface FakeRow {
  id: string
  key: string
  value: string
  encrypted: boolean
}

function row(id: string, opts: Partial<FakeRow> = {}): FakeRow {
  return { id, key: `key-${id}`, value: `value-${id}`, encrypted: false, ...opts }
}

function makeSupabaseMock(initial: FakeRow[]) {
  const rows = initial.map((r) => ({ ...r }))
  const supabase = {
    from: (table: string) => ({
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        let working = rows.filter(() => table === 'memories')
        let limit: number | null = null
        const builder = {
          eq: (col: string, val: unknown) => {
            working = working.filter(() => col !== 'project_id' || val === PROJECT)
            return builder
          },
          gt: (col: string, val: string) => {
            if (col === 'id') working = working.filter((r) => r.id > val)
            return builder
          },
          lte: (col: string, val: string) => {
            if (col === 'id') working = working.filter((r) => r.id <= val)
            return builder
          },
          order: (_col: string, o?: { ascending?: boolean }) => {
            working = [...working].sort((a, b) =>
              o?.ascending === false ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id),
            )
            return builder
          },
          limit: (n: number) => {
            limit = n
            return builder
          },
          then: (resolve: (v: unknown) => void) => {
            const sliced = limit === null ? working : working.slice(0, limit)
            resolve(
              opts?.head
                ? { count: working.length, error: null }
                : { data: sliced.map((r) => ({ ...r })), count: working.length, error: null },
            )
          },
        }
        return builder
      },
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, rows }
}

/** Records every remoteUpsertChunks call — the delete-then-insert boundary. */
function makeSyncMock(fail: (key: string) => boolean = () => false) {
  const calls: Array<{ projectId: string; key: string; chunkCount: number }> = []
  return {
    calls,
    sync: {
      remoteUpsertChunks: vi.fn(async (projectId: string, key: string, chunks: Array<{ text: string }>) => {
        calls.push({ projectId, key, chunkCount: chunks.length })
        return !fail(key)
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  }
}

function makeMemoryCheckpoint(initial: string | null = null): BackfillCheckpoint & { value: string | null } {
  const state = {
    value: initial,
    load: () => state.value,
    save: (id: string) => {
      state.value = id
    },
    clear: () => {
      state.value = null
    },
  }
  return state
}

beforeEach(() => {
  mockGenerateChunks.mockReset()
  mockResolveProvider.mockReset()
  mockResolveProvider.mockReturnValue('hosted')
  mockGenerateChunks.mockResolvedValue({
    pooled: [0.1, 0.2],
    chunks: [{ text: 'chunk', embedding: [0.1, 0.2] }],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('backfillChunkEmbeddings — full re-chunk semantics', () => {
  it('re-chunks every memory, including ones that already have chunk rows', async () => {
    // The old version issued a per-memory "does it already have chunks?"
    // query and skipped on a hit. That check is gone; nothing here should
    // consult memory_chunks at all before writing.
    const { supabase } = makeSupabaseMock([row('a'), row('b'), row('c')])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync })

    expect(result.total).toBe(3)
    expect(result.updated).toBe(3)
    expect(result.failed).toBe(0)
    expect(calls.map((c) => c.key)).toEqual(['key-a', 'key-b', 'key-c'])
  })

  it('includes short memories that the old CHUNK_TARGET_CHARS floor excluded', async () => {
    const shortValue = 'x'.repeat(HOSTED_CHUNK_TARGET_CHARS + 10)
    expect(shortValue.length).toBeLessThan(CHUNK_TARGET_CHARS)

    const { supabase } = makeSupabaseMock([row('a', { value: shortValue }), row('b', { value: 'tiny' })])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync })

    expect(result.updated).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('--min-chars restores an explicit floor without breaking resumability', async () => {
    const { supabase } = makeSupabaseMock([
      row('a', { value: 'tiny' }),
      row('b', { value: 'x'.repeat(2000) }),
    ])
    const { sync, calls } = makeSyncMock()
    const checkpoint = makeMemoryCheckpoint()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, minChars: 1000, checkpoint })

    expect(result.belowFloor).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)
    expect(calls.map((c) => c.key)).toEqual(['key-b'])
    // A below-floor row is out of scope, not a failure — it must not pin the
    // watermark, or --min-chars would make the run unresumable.
    expect(checkpoint.value).toBeNull()
  })

  it('passes the project id and memory key through to remoteUpsertChunks', async () => {
    // remoteUpsertChunks keys on (project_id, key), not the local row id —
    // that resolution is what makes the delete-then-insert hit the right rows.
    const { supabase } = makeSupabaseMock([row('a')])
    const { sync, calls } = makeSyncMock()

    await backfillChunkEmbeddings(supabase, PROJECT, { sync })

    expect(calls[0]).toEqual({ projectId: PROJECT, key: 'key-a', chunkCount: 1 })
  })

  it('dry run estimates chunk rows and writes nothing', async () => {
    const { supabase } = makeSupabaseMock([row('a', { value: 'x'.repeat(5000) }), row('b')])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.total).toBe(2)
    expect(result.estimatedChunks).toBeGreaterThan(2)
    expect(result.estimatedCalls).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)
    expect(mockGenerateChunks).not.toHaveBeenCalled()
  })

  it('counts a memory as failed when chunk embedding is unavailable', async () => {
    mockGenerateChunks.mockResolvedValue(null)
    const { supabase } = makeSupabaseMock([row('a')])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, retries: 0 })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('retries a memory whose chunk embedding momentarily returns nothing', async () => {
    mockGenerateChunks
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ pooled: [0.1, 0.2], chunks: [{ text: 'chunk', embedding: [0.1, 0.2] }] })
    const { supabase } = makeSupabaseMock([row('a')])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, retries: 2, retryBackoffMs: 0 })

    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockGenerateChunks).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(1)
  })

  it('counts a memory as failed when the chunk write is rejected', async () => {
    const { supabase } = makeSupabaseMock([row('a'), row('b')])
    const { sync } = makeSyncMock((key) => key === 'key-a')

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(1)
  })
})

describe('backfillChunkEmbeddings — resumability', () => {
  it('resumes after a stored checkpoint', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`id-${i}`))
    const { supabase } = makeSupabaseMock(rows)
    const { sync, calls } = makeSyncMock()
    const checkpoint = makeMemoryCheckpoint('id-1')

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, checkpoint, pageSize: 2 })

    expect(result.resumedPast).toBe(2)
    expect(calls.map((c) => c.key)).toEqual(['key-id-2', 'key-id-3', 'key-id-4'])
  })

  it('an interrupted run resumes without duplicating or losing memories', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase } = makeSupabaseMock(rows)
    const { sync, calls } = makeSyncMock()
    const checkpoint = makeMemoryCheckpoint()

    let pages = 0
    const first = await backfillChunkEmbeddings(supabase, PROJECT, {
      sync,
      checkpoint,
      pageSize: 2,
      shouldStop: () => pages++ >= 1,
    })
    expect(first.updated).toBe(2)
    expect(checkpoint.value).toBe('id-1')

    const second = await backfillChunkEmbeddings(supabase, PROJECT, { sync, checkpoint, pageSize: 2 })

    expect(second.resumedPast).toBe(2)
    expect(second.updated).toBe(4)
    expect(calls.map((c) => c.key)).toEqual([
      'key-id-0',
      'key-id-1',
      'key-id-2',
      'key-id-3',
      'key-id-4',
      'key-id-5',
    ])
  })

  it('pins the checkpoint below a failed memory', async () => {
    const { supabase } = makeSupabaseMock([row('id-0'), row('id-1'), row('id-2')])
    const { sync } = makeSyncMock((key) => key === 'key-id-1')
    const checkpoint = makeMemoryCheckpoint()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, checkpoint, pageSize: 3 })

    expect(result.failed).toBe(1)
    expect(checkpoint.value).toBe('id-0')
  })

  it('a failure in an earlier page freezes the checkpoint for the whole run', async () => {
    // Same cross-page regression as backfill-embeddings.ts.
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase } = makeSupabaseMock(rows)
    const { sync } = makeSyncMock((key) => key === 'key-id-1')
    const checkpoint = makeMemoryCheckpoint()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, checkpoint, pageSize: 2 })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(5)
    expect(checkpoint.value).toBe('id-0')
  })
})

describe('backfillChunkEmbeddings — encryption and logging', () => {
  it('fails an encrypted memory with no key, without logging its ciphertext', async () => {
    const logged: string[] = []
    const secret = 'SUPER-SECRET-CIPHERTEXT'
    const { supabase } = makeSupabaseMock([row('a', { encrypted: true, value: secret })])
    const { sync, calls } = makeSyncMock()

    const result = await backfillChunkEmbeddings(supabase, PROJECT, { sync, log: (l) => logged.push(l) })

    expect(result.failed).toBe(1)
    expect(calls).toHaveLength(0)
    const all = logged.join('\n')
    expect(all).toContain('a')
    expect(all).not.toContain(secret)
  })

  it('never logs plaintext on the happy path', async () => {
    const logged: string[] = []
    const { supabase } = makeSupabaseMock([row('a', { value: 'PLAINTEXT-SENTINEL' })])
    const { sync } = makeSyncMock()

    await backfillChunkEmbeddings(supabase, PROJECT, { sync, log: (l) => logged.push(l) })

    expect(logged.join('\n')).not.toContain('PLAINTEXT-SENTINEL')
  })
})
