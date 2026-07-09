/**
 * Tests for Task 11: sandbox-scoped one-time embedding backfill.
 *
 * Exercises `backfillEmbeddings()` (the testable core, decoupled from the
 * CLI arg-parsing / auth wrapper) against a mocked Supabase client:
 *   - dry-run mode reports a count without writing
 *   - a real run pages through embedding-IS-NULL rows, decrypts when needed,
 *     and writes pgvector-literal embeddings back
 *   - plaintext/ciphertext is never logged (only ids and error messages)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { backfillEmbeddings } from './backfill-embeddings'

vi.mock('../src/embeddings', () => ({
  generateEmbedding: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { generateEmbedding } from '../src/embeddings'
const mockGenerateEmbedding = vi.mocked(generateEmbedding)

interface FakeRow {
  id: string
  value: string
  encrypted: boolean
}

function makeSupabaseMock(rows: FakeRow[]) {
  let remaining = [...rows]
  const updated: Array<{ id: string; embedding: string }> = []

  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
        const builder = {
          eq: vi.fn(() => builder),
          is: vi.fn(() => builder),
          limit: vi.fn((n: number) => {
            const batch = remaining.slice(0, n)
            if (opts?.head) {
              return Promise.resolve({ count: remaining.length, error: null })
            }
            return Promise.resolve({ data: batch, error: null })
          }),
        }
        // count queries (dry-run) don't call .limit() — they resolve directly
        // once .eq()/.is() chain completes, so also make the builder itself
        // thenable for that path.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(builder as any).then = (resolve: (v: unknown) => void) => {
          resolve({ count: remaining.length, error: null })
        }
        return builder
      }),
      update: vi.fn((patch: { embedding: string }) => ({
        eq: vi.fn((_col: string, id: string) => {
          updated.push({ id, embedding: patch.embedding })
          remaining = remaining.filter((r) => r.id !== id)
          return Promise.resolve({ error: null })
        }),
      })),
    })),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, updated, getRemaining: () => remaining }
}

describe('backfillEmbeddings', () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dry run reports the remaining count and writes nothing', async () => {
    const { supabase, updated } = makeSupabaseMock([
      { id: 'a', value: 'v1', encrypted: false },
      { id: 'b', value: 'v2', encrypted: false },
    ])

    const result = await backfillEmbeddings(supabase, 'proj-1', { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.totalRemaining).toBe(2)
    expect(result.updated).toBe(0)
    expect(updated).toHaveLength(0)
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('generates and writes embeddings for plaintext memories', async () => {
    const { supabase, updated } = makeSupabaseMock([
      { id: 'a', value: 'plain value a', encrypted: false },
      { id: 'b', value: 'plain value b', encrypted: false },
    ])
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])

    const result = await backfillEmbeddings(supabase, 'proj-1', { batchSize: 10 })

    expect(result.processed).toBe(2)
    expect(result.updated).toBe(2)
    expect(result.failed).toBe(0)
    expect(updated).toHaveLength(2)
    expect(updated[0].embedding).toBe('[0.1,0.2,0.3]')
  })

  it('marks a row failed (not crashing the batch) when no embedding provider is available', async () => {
    const { supabase, updated } = makeSupabaseMock([
      { id: 'a', value: 'v', encrypted: false },
    ])
    mockGenerateEmbedding.mockResolvedValue(null)

    const result = await backfillEmbeddings(supabase, 'proj-1')

    expect(result.processed).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.failed).toBe(1)
    expect(updated).toHaveLength(0)
  })

  it('never logs plaintext or ciphertext, only ids and error messages', async () => {
    const { supabase } = makeSupabaseMock([
      { id: 'sensitive-row-id', value: 'super secret plaintext content', encrypted: false },
    ])
    mockGenerateEmbedding.mockRejectedValue(new Error('provider exploded'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await backfillEmbeddings(supabase, 'proj-1')

    const loggedText = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(loggedText).toContain('sensitive-row-id')
    expect(loggedText).not.toContain('super secret plaintext content')
    errorSpy.mockRestore()
  })
})
