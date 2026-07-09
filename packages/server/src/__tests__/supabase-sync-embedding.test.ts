/**
 * Tests for Task 8's embedding round-trip through supabase-sync.ts:
 *   - memoryToDbRow serializes Memory.embedding into a pgvector literal string
 *   - dbRowToMemory parses that string back into a number[]
 *   - crucially: when a Memory has NO embedding, the row omits the `embedding`
 *     key entirely (rather than sending null) so a sync that races ahead of
 *     embedding generation can't stomp an already-computed remote embedding.
 *
 * We can't hit real Supabase, so we exercise the round-trip via a mocked
 * client and inspect exactly what payload would be sent over the wire.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Memory } from '@tages/shared'
import { SupabaseSync, embeddingToPgVector, pgVectorToEmbedding } from '../sync/supabase-sync'
import type { SqliteCache } from '../cache/sqlite'

function baseMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1',
    projectId: 'proj-1',
    key: 'test-key',
    value: 'test value',
    type: 'convention',
    source: 'agent',
    status: 'live',
    confidence: 1.0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('embeddingToPgVector / pgVectorToEmbedding', () => {
  it('serializes a number[] into a pgvector literal string', () => {
    expect(embeddingToPgVector([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })

  it('round-trips a pgvector literal string back into a number[]', () => {
    const vec = [0.1, -0.2, 3, 0]
    expect(pgVectorToEmbedding(embeddingToPgVector(vec))).toEqual(vec)
  })

  it('handles an empty vector literal', () => {
    expect(pgVectorToEmbedding('[]')).toEqual([])
  })
})

describe('SupabaseSync.remoteInsert — embedding serialization', () => {
  function makeSupabaseMock() {
    const upsertCalls: unknown[] = []
    const supabase = {
      from: vi.fn(() => ({
        upsert: vi.fn((row: unknown) => {
          upsertCalls.push(row)
          return Promise.resolve({ error: null })
        }),
      })),
    }
    return { supabase, upsertCalls }
  }

  it('includes a pgvector-literal embedding column when the memory has one', async () => {
    const { supabase, upsertCalls } = makeSupabaseMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const embedding = [0.5, 0.25, -0.1]
    const memory = baseMemory({ embedding })

    const ok = await sync.remoteInsert(memory)
    expect(ok).toBe(true)
    expect(upsertCalls).toHaveLength(1)
    const row = upsertCalls[0] as { embedding?: string }
    expect(row.embedding).toBe(embeddingToPgVector(embedding))
  })

  it('omits the embedding key entirely when the memory has no embedding (does not send null)', async () => {
    const { supabase, upsertCalls } = makeSupabaseMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const memory = baseMemory() // no embedding field set

    const ok = await sync.remoteInsert(memory)
    expect(ok).toBe(true)
    expect(upsertCalls).toHaveLength(1)
    const row = upsertCalls[0] as Record<string, unknown>
    // The key must be absent, not present-with-null — an upsert with an
    // explicit `embedding: null` would overwrite a previously-synced
    // embedding on unrelated field updates.
    expect('embedding' in row).toBe(false)
  })

  it('omits the embedding key for an empty embedding array too', async () => {
    const { supabase, upsertCalls } = makeSupabaseMock()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const memory = baseMemory({ embedding: [] })
    await sync.remoteInsert(memory)

    const row = upsertCalls[0] as Record<string, unknown>
    expect('embedding' in row).toBe(false)
  })
})

describe('dbRowToMemory (via remoteRecall) — embedding deserialization', () => {
  it('parses a pgvector string column back into Memory.embedding', async () => {
    const embedding = [1, 2.5, -3]
    const dbRow = {
      id: 'mem-1',
      project_id: 'proj-1',
      key: 'k',
      value: 'v',
      type: 'convention',
      source: 'agent',
      status: 'live',
      agent_name: null,
      file_paths: [],
      tags: [],
      confidence: 1,
      conditions: null,
      phases: null,
      cross_system_refs: null,
      examples: null,
      execution_flow: null,
      verified_at: null,
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      created_by: null,
      updated_by: null,
      encrypted: false,
      embedding: embeddingToPgVector(embedding),
    }

    const supabase = {
      rpc: vi.fn(() => Promise.resolve({ data: [dbRow], error: null })),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const results = await sync.remoteRecall('query')
    expect(results).not.toBeNull()
    expect(results![0].embedding).toEqual(embedding)
  })

  it('leaves Memory.embedding undefined when the column is null', async () => {
    const dbRow = {
      id: 'mem-1',
      project_id: 'proj-1',
      key: 'k',
      value: 'v',
      type: 'convention',
      source: 'agent',
      status: 'live',
      agent_name: null,
      file_paths: [],
      tags: [],
      confidence: 1,
      conditions: null,
      phases: null,
      cross_system_refs: null,
      examples: null,
      execution_flow: null,
      verified_at: null,
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      created_by: null,
      updated_by: null,
      encrypted: false,
      embedding: null,
    }

    const supabase = {
      rpc: vi.fn(() => Promise.resolve({ data: [dbRow], error: null })),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = new SupabaseSync(supabase as any, {} as SqliteCache, 'proj-1')

    const results = await sync.remoteRecall('query')
    expect(results![0].embedding).toBeUndefined()
  })
})
