/**
 * Tests for the full hosted re-embed of `memories.embedding`
 * (PLAN-HOSTED-EMBEDDING.md Task 4).
 *
 * The behaviour under test changed shape, so these are largely new rather
 * than adjusted. What matters here:
 *   - a run re-embeds rows that ALREADY have a vector (the whole point — every
 *     pre-existing vector is from a different model and therefore invalid)
 *   - long rows never reach `generateHostedEmbeddingsBatch`, which does no
 *     chunking and would have gte-small silently truncate them behind a 200
 *   - the watermark checkpoint makes an interrupted run resumable without
 *     either duplicating work or stranding a failed row
 *   - plaintext/ciphertext is still never logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  backfillEmbeddings,
  computeWatermark,
  createNullCheckpoint,
  estimateHostedCalls,
  formatDuration,
  formatProgressLine,
  type BackfillCheckpoint,
} from './backfill-embeddings'

vi.mock('../src/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/embeddings')>()
  return {
    ...actual,
    generateEmbedding: vi.fn(),
    generateHostedEmbeddingsBatch: vi.fn(),
    resolveEmbeddingProvider: vi.fn(() => 'hosted'),
  }
})

import {
  generateEmbedding,
  generateHostedEmbeddingsBatch,
  resolveEmbeddingProvider,
  HOSTED_MAX_BATCH,
  HOSTED_CHUNK_TARGET_CHARS,
} from '../src/embeddings'

const mockGenerateEmbedding = vi.mocked(generateEmbedding)
const mockBatch = vi.mocked(generateHostedEmbeddingsBatch)
const mockResolveProvider = vi.mocked(resolveEmbeddingProvider)

const PROJECT = 'proj-1'

interface FakeRow {
  id: string
  value: string
  encrypted: boolean
  embedding: string | null
}

function row(id: string, opts: Partial<FakeRow> = {}): FakeRow {
  return { id, value: `value-${id}`, encrypted: false, embedding: null, ...opts }
}

/** A memory long enough to need chunking on the hosted path. */
function longRow(id: string, opts: Partial<FakeRow> = {}): FakeRow {
  return row(id, { value: 'x'.repeat(HOSTED_CHUNK_TARGET_CHARS + 500), ...opts })
}

/**
 * A small but faithful stand-in for the PostgREST query builder: enough of
 * .eq/.is/.gt/.lte/.order/.limit to exercise keyset paging and the count
 * queries for real, rather than asserting against a builder that ignores its
 * own filters.
 */
function makeSupabaseMock(initial: FakeRow[]) {
  const rows = initial.map((r) => ({ ...r }))
  const updates: Array<{ id: string; embedding: string }> = []

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
          is: (col: string, val: unknown) => {
            if (col === 'embedding' && val === null) working = working.filter((r) => r.embedding === null)
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
          order: (col: string, o?: { ascending?: boolean }) => {
            working = [...working].sort((a, b) =>
              o?.ascending === false ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id),
            )
            void col
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
      update: (patch: { embedding: string }) => ({
        eq: (_col: string, id: string) => {
          const target = rows.find((r) => r.id === id)
          if (target) target.embedding = patch.embedding
          updates.push({ id, embedding: patch.embedding })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, updates, rows }
}

/** In-memory checkpoint, same contract as the file-backed one. */
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

const VEC = [0.1, 0.2, 0.3]

beforeEach(() => {
  mockGenerateEmbedding.mockReset()
  mockBatch.mockReset()
  mockResolveProvider.mockReset()
  mockResolveProvider.mockReturnValue('hosted')
  mockGenerateEmbedding.mockResolvedValue(VEC)
  mockBatch.mockImplementation(async (texts: string[]) => texts.map(() => VEC))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('backfillEmbeddings — full re-embed semantics', () => {
  it('re-embeds rows that ALREADY have an embedding', async () => {
    // The core behaviour change. These rows would all have been skipped by
    // the previous `embedding IS NULL` filter.
    const { supabase, updates } = makeSupabaseMock([
      row('a', { embedding: '[stale]' }),
      row('b', { embedding: '[stale]' }),
      row('c', { embedding: '[stale]' }),
    ])

    const result = await backfillEmbeddings(supabase, PROJECT, {})

    expect(result.total).toBe(3)
    expect(result.updated).toBe(3)
    expect(result.failed).toBe(0)
    expect(updates.map((u) => u.id)).toEqual(['a', 'b', 'c'])
  })

  it('--only-missing restores the legacy embedding-IS-NULL filter', async () => {
    const { supabase, updates } = makeSupabaseMock([
      row('a', { embedding: '[stale]' }),
      row('b'),
      row('c', { embedding: '[stale]' }),
    ])

    const result = await backfillEmbeddings(supabase, PROJECT, { onlyMissing: true })

    expect(result.total).toBe(1)
    expect(updates.map((u) => u.id)).toEqual(['b'])
  })

  it('dry run counts every row and writes nothing', async () => {
    const { supabase, updates } = makeSupabaseMock([
      row('a', { embedding: '[stale]' }),
      row('b', { embedding: '[stale]' }),
    ])

    const result = await backfillEmbeddings(supabase, PROJECT, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.total).toBe(2)
    expect(result.estimatedCalls).toBe(1) // both short — one batched call
    expect(updates).toHaveLength(0)
    expect(mockBatch).not.toHaveBeenCalled()
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('pages through more rows than one page holds', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`id-${String(i).padStart(2, '0')}`))
    const { supabase, updates } = makeSupabaseMock(rows)

    const result = await backfillEmbeddings(supabase, PROJECT, { pageSize: 10 })

    expect(result.total).toBe(25)
    expect(result.updated).toBe(25)
    expect(updates).toHaveLength(25)
  })
})

describe('backfillEmbeddings — hosted batching', () => {
  it('batches short rows HOSTED_MAX_BATCH at a time', async () => {
    const rows = Array.from({ length: HOSTED_MAX_BATCH * 2 + 3 }, (_, i) =>
      row(`id-${String(i).padStart(2, '0')}`),
    )
    const { supabase } = makeSupabaseMock(rows)

    await backfillEmbeddings(supabase, PROJECT, { pageSize: 100 })

    expect(mockBatch).toHaveBeenCalledTimes(3)
    expect(mockBatch.mock.calls[0][0]).toHaveLength(HOSTED_MAX_BATCH)
    expect(mockBatch.mock.calls[1][0]).toHaveLength(HOSTED_MAX_BATCH)
    expect(mockBatch.mock.calls[2][0]).toHaveLength(3)
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('never sends an over-length row to the batch endpoint', async () => {
    // generateHostedEmbeddingsBatch does no chunking; gte-small truncates
    // silently and still returns 200, so a long text sent this way loses
    // content with nothing to observe. Long rows must go via
    // generateEmbedding, which chunks and pools.
    const { supabase } = makeSupabaseMock([row('a'), longRow('b'), row('c')])

    await backfillEmbeddings(supabase, PROJECT, { pageSize: 100 })

    const batched = mockBatch.mock.calls.flatMap((call) => call[0])
    expect(batched).toHaveLength(2)
    for (const text of batched) {
      expect(text.length).toBeLessThanOrEqual(HOSTED_CHUNK_TARGET_CHARS)
    }
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1)
    expect(mockGenerateEmbedding.mock.calls[0][0].length).toBeGreaterThan(HOSTED_CHUNK_TARGET_CHARS)
  })

  it('falls back to per-row embedding when a batch fails', async () => {
    // generateHostedEmbeddingsBatch is fail-closed for the whole array it is
    // given, so one bad text would otherwise cost all 8 rows.
    mockBatch.mockResolvedValue(null)
    const { supabase, updates } = makeSupabaseMock([row('a'), row('b'), row('c')])

    const result = await backfillEmbeddings(supabase, PROJECT, {})

    expect(result.updated).toBe(3)
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(3)
    expect(updates).toHaveLength(3)
  })

  it('never calls the hosted batch export under a non-hosted provider', async () => {
    mockResolveProvider.mockReturnValue('ollama')
    const { supabase, updates } = makeSupabaseMock([row('a'), row('b')])

    const result = await backfillEmbeddings(supabase, PROJECT, {})

    expect(mockBatch).not.toHaveBeenCalled()
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(result.updated).toBe(2)
    expect(updates).toHaveLength(2)
  })

  it('counts a row as failed when no provider produces a vector', async () => {
    mockBatch.mockResolvedValue(null)
    mockGenerateEmbedding.mockResolvedValue(null)
    const { supabase, updates } = makeSupabaseMock([row('a')])

    const result = await backfillEmbeddings(supabase, PROJECT, { retries: 0 })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('retries a row that momentarily returns no vector', async () => {
    // The edge function returns HTTP 546 WORKER_RESOURCE_LIMIT under memory
    // pressure (seen live on dev against long memories). It is a resource
    // condition rather than a property of the input, so a retry clears it.
    mockBatch.mockResolvedValue(null)
    mockGenerateEmbedding.mockResolvedValueOnce(null).mockResolvedValue(VEC)
    const { supabase, updates } = makeSupabaseMock([row('a')])

    const result = await backfillEmbeddings(supabase, PROJECT, { retries: 2 })

    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(2)
    expect(updates).toHaveLength(1)
  })
})

describe('backfillEmbeddings — resumability', () => {
  it('saves a checkpoint as it goes and clears it on clean completion', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase } = makeSupabaseMock(rows)
    const checkpoint = makeMemoryCheckpoint()

    await backfillEmbeddings(supabase, PROJECT, { pageSize: 2, checkpoint })

    // Cleared, because the run finished with zero failures.
    expect(checkpoint.value).toBeNull()
  })

  it('resumes after a stored checkpoint without redoing earlier rows', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase, updates } = makeSupabaseMock(rows)
    const checkpoint = makeMemoryCheckpoint('id-2')

    const result = await backfillEmbeddings(supabase, PROJECT, { pageSize: 2, checkpoint })

    expect(result.resumedPast).toBe(3) // id-0, id-1, id-2
    expect(result.processed).toBe(3) // id-3, id-4, id-5
    expect(updates.map((u) => u.id)).toEqual(['id-3', 'id-4', 'id-5'])
  })

  it('pins the checkpoint below a failed row so a restart retries it', async () => {
    // id-1 fails; the watermark must stay at id-0 even though id-2 succeeded
    // afterwards, or a restart would skip past the row that never got a vector.
    mockBatch.mockResolvedValue(null)
    mockGenerateEmbedding.mockImplementation(async (text: string) =>
      text === 'value-id-1' ? null : VEC,
    )
    const { supabase } = makeSupabaseMock([row('id-0'), row('id-1'), row('id-2')])
    const checkpoint = makeMemoryCheckpoint()

    const result = await backfillEmbeddings(supabase, PROJECT, { pageSize: 3, checkpoint, retries: 0 })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(2)
    expect(checkpoint.value).toBe('id-0')
    // Not cleared — the run had a failure, so the checkpoint survives.
    expect(checkpoint.value).not.toBeNull()
  })

  it('a failure in an earlier page freezes the checkpoint for the whole run', async () => {
    // Regression: the watermark used to be saved per page, so a later page's
    // higher value overwrote an earlier page's lower one and the cursor
    // stepped straight over the failed row — it would keep its stale vector
    // forever and never be retried. Caught on a live dev run.
    mockBatch.mockResolvedValue(null)
    mockGenerateEmbedding.mockImplementation(async (text: string) =>
      text === 'value-id-1' ? null : VEC,
    )
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase } = makeSupabaseMock(rows)
    const checkpoint = makeMemoryCheckpoint()

    const result = await backfillEmbeddings(supabase, PROJECT, { pageSize: 2, checkpoint, retries: 0 })

    expect(result.failed).toBe(1)
    expect(result.updated).toBe(5)
    // id-1 failed in page 1. Pages 2 and 3 succeeded entirely, but the
    // checkpoint must NOT have advanced past id-0.
    expect(checkpoint.value).toBe('id-0')
  })

  it('an interrupted run resumes without duplicating or losing rows', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`id-${i}`))
    const { supabase, updates } = makeSupabaseMock(rows)
    const checkpoint = makeMemoryCheckpoint()

    // First run: stop after the first page of 2.
    let pages = 0
    const first = await backfillEmbeddings(supabase, PROJECT, {
      pageSize: 2,
      checkpoint,
      shouldStop: () => pages++ >= 1,
    })
    expect(first.updated).toBe(2)
    expect(checkpoint.value).toBe('id-1')

    // Second run: picks up exactly where the first stopped.
    const second = await backfillEmbeddings(supabase, PROJECT, { pageSize: 2, checkpoint })

    expect(second.resumedPast).toBe(2)
    expect(second.updated).toBe(4)
    // Every row written exactly once across the two runs — no gaps, no repeats.
    expect(updates.map((u) => u.id)).toEqual(['id-0', 'id-1', 'id-2', 'id-3', 'id-4', 'id-5'])
  })

  it('--since overrides a stored checkpoint', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(`id-${i}`))
    const { supabase, updates } = makeSupabaseMock(rows)
    const checkpoint = makeMemoryCheckpoint('id-0')

    await backfillEmbeddings(supabase, PROJECT, { pageSize: 10, checkpoint, since: 'id-2' })

    expect(updates.map((u) => u.id)).toEqual(['id-3'])
  })
})

describe('backfillEmbeddings — encryption and logging', () => {
  it('fails an encrypted row when no encryption key is set, without logging its value', async () => {
    const logged: string[] = []
    const secret = 'SUPER-SECRET-CIPHERTEXT'
    const { supabase, updates } = makeSupabaseMock([row('a', { encrypted: true, value: secret })])

    const result = await backfillEmbeddings(supabase, PROJECT, { log: (l) => logged.push(l) })

    expect(result.failed).toBe(1)
    expect(updates).toHaveLength(0)
    const all = logged.join('\n')
    expect(all).toContain('a')
    expect(all).not.toContain(secret)
  })

  it('never logs plaintext on the happy path', async () => {
    const logged: string[] = []
    const { supabase } = makeSupabaseMock([row('a', { value: 'PLAINTEXT-SENTINEL' })])

    await backfillEmbeddings(supabase, PROJECT, { log: (l) => logged.push(l) })

    expect(logged.join('\n')).not.toContain('PLAINTEXT-SENTINEL')
  })
})

describe('pure helpers', () => {
  it('computeWatermark stops at the first failure', () => {
    expect(computeWatermark(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toBe('c')
    expect(computeWatermark(['a', 'b', 'c'], new Set(['a', 'c']))).toBe('a')
    expect(computeWatermark(['a', 'b', 'c'], new Set(['b', 'c']))).toBeNull()
    expect(computeWatermark([], new Set())).toBeNull()
  })

  it('estimateHostedCalls batches short texts and chunks long ones', () => {
    // 8 short texts fit one call.
    expect(estimateHostedCalls(Array.from({ length: HOSTED_MAX_BATCH }, () => 'hi'))).toBe(1)
    expect(estimateHostedCalls(Array.from({ length: HOSTED_MAX_BATCH + 1 }, () => 'hi'))).toBe(2)
    // A long text costs at least one call of its own, and more than a short one.
    const long = 'x'.repeat(HOSTED_CHUNK_TARGET_CHARS * 10)
    expect(estimateHostedCalls([long])).toBeGreaterThan(1)
    expect(estimateHostedCalls([])).toBe(0)
  })

  it('formatDuration renders seconds, minutes and hours', () => {
    expect(formatDuration(5000)).toBe('5s')
    expect(formatDuration(65000)).toBe('1m05s')
    expect(formatDuration(3_700_000)).toBe('1h01m')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('?')
  })

  it('formatProgressLine reports counts, rate and ETA', () => {
    const line = formatProgressLine({ done: 25, total: 100, updated: 24, failed: 1, elapsedMs: 5000 })
    expect(line).toContain('25/100 rows (25%)')
    expect(line).toContain('24 updated')
    expect(line).toContain('1 failed')
    expect(line).toContain('5.00 rows/s')
    expect(line).toContain('ETA 15s')
  })

  it('formatProgressLine shows a zero ETA when everything is done', () => {
    const line = formatProgressLine({ done: 10, total: 10, updated: 10, failed: 0, elapsedMs: 1000 })
    expect(line).toContain('(100%)')
    expect(line).toContain('ETA 0s')
  })

  it('the null checkpoint remembers nothing', () => {
    const cp = createNullCheckpoint()
    cp.save('x')
    expect(cp.load()).toBeNull()
  })
})
