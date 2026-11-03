import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { setupTempConfigDir, writeProjectConfig, captureConsole, TEST_PROJECT_CONFIG } from './helpers.js'
import { __resetEmbeddingProviderForTests } from '../lib/embedding.js'

/**
 * 0.5.7 bugs 10 and 13 on the CLI recall path.
 *
 * Bug 10: two memories with identical text written 2.5s apart. Near-duplicate
 * dedupe kept whichever ranked first, which was RPC order, so the OLDER one was
 * often the one shown. The newer must be the one served, every time.
 *
 * Bug 13: the evidence weighting was a partition (stable sort on the weight
 * alone), so a just-written CLI memory (`declared`, 0.95) queried by its own
 * exact sentence sat behind every NULL-evidence row (1.0) and fell off
 * `--limit`. Reproduced on prod at 55 memories; see
 * docs/recall-miss-diagnosis-0.5.7.md.
 *
 * Every test here runs the trigram path only: no embedding provider answers
 * (fetch rejects), so `semantic_recall`/`chunk_semantic_recall` are never
 * called, and `recall_memories` is the one ranked list.
 */

const originalFetch = globalThis.fetch
const PROVIDER_ENV_KEYS = [
  'TAGES_EMBED_PROVIDER',
  'TAGES_OPENAI_EMBED',
  'OPENAI_API_KEY',
  'TAGES_EMBED_URL',
  'SUPABASE_URL',
  'TAGES_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
] as const
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))
  savedEnv = {}
  for (const key of PROVIDER_ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  __resetEmbeddingProviderForTests()
})
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of PROVIDER_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  __resetEmbeddingProviderForTests()
})

const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })),
  },
}
vi.mock('@tages/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tages/shared')>()),
  createSupabaseClient: vi.fn(() => mockSupabase),
}))
vi.mock('../lib/reranker.js', () => ({
  rerankCandidates: vi.fn(async (_query: string, candidates: Array<{ id: string }>) => candidates.map((c) => c.id)),
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

import { recallCommand } from '../commands/recall.js'

type Row = { id: string; key: string; value: string; type: string; similarity: number; updated_at: string; created_at: string }

/** recall_memories returns `rows`; the evidence lookup returns `evidence` by id. */
function serve(rows: Row[], evidence: Record<string, string> = {}) {
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === 'recall_memories' ? { data: rows.map((r) => ({ ...r })), error: null } : { data: null, error: null }),
  )
  mockFrom.mockImplementation(() => ({
    select: () => ({
      in: (_col: string, ids: string[]) =>
        Promise.resolve({
          data: ids.filter((id) => evidence[id]).map((id) => ({ id, evidence: evidence[id] })),
          error: null,
        }),
    }),
  }))
}

/** Keys in printed order. */
function printedKeys(logs: string[], candidates: string[]): string[] {
  const out = logs.join('\n')
  return candidates.filter((k) => out.includes(k)).sort((a, b) => out.indexOf(a) - out.indexOf(b))
}

describe('recall: newest wins, deterministic ties (bug 10)', () => {
  let console_: ReturnType<typeof captureConsole>
  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
  })
  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  const text = 'The nightly cache warmup job refreshes every search index shard in a fixed order.'
  const older: Row = { id: 'id-old', key: 'tie-old', value: text, type: 'convention', similarity: 0.9, created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z' }
  const newer: Row = { id: 'id-new', key: 'tie-new', value: text, type: 'convention', similarity: 0.9, created_at: '2026-11-01T10:00:02.500Z', updated_at: '2026-11-01T10:00:02.500Z' }

  it('serves only the newer of two identical-text memories when the older ranks first, stable over 6 runs', async () => {
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      console_.logs.length = 0
      serve([older, newer])
      await recallCommand('nightly cache warmup', {})
      seen.push(printedKeys(console_.logs, ['tie-old', 'tie-new']).join(','))
    }
    expect(seen).toEqual(Array(6).fill('tie-new'))
  })

  it('serves only the newer one when it already ranks first', async () => {
    serve([newer, older])
    await recallCommand('nightly cache warmup', {})
    expect(printedKeys(console_.logs, ['tie-old', 'tie-new'])).toEqual(['tie-new'])
  })

  it('keeps the newer copy in the older copy\'s slot, ahead of a distinct row ranked between them', async () => {
    const between: Row = { ...older, id: 'id-mid', key: 'distinct-mid', value: 'Search shards rebuild on Sundays only.' }
    serve([older, between, newer])
    await recallCommand('nightly cache warmup', {})
    expect(printedKeys(console_.logs, ['tie-old', 'tie-new', 'distinct-mid'])).toEqual(['tie-new', 'distinct-mid'])
  })

  it('still drops a shorter row contained in a longer kept row even when the shorter one is newer', async () => {
    const longOld: Row = { ...older, key: 'long-old', value: `${text} It runs at 02:00 UTC from the ops scheduler.` }
    serve([longOld, newer])
    await recallCommand('nightly cache warmup', {})
    expect(printedKeys(console_.logs, ['long-old', 'tie-new'])).toEqual(['long-old'])
  })
})

describe('recall: evidence scales relevance instead of partitioning it (bug 13)', () => {
  let console_: ReturnType<typeof captureConsole>
  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
  })
  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  const at = '2026-11-01T10:00:00.000Z'
  const row = (i: number, value: string): Row => ({ id: `id-${i}`, key: `k-${String(i).padStart(2, '0')}`, value, type: 'lesson', similarity: 0.5, created_at: at, updated_at: at })

  it('a `declared` exact match ranked first stays inside --limit 10 when 14 NULL-evidence rows follow it', async () => {
    const target = { ...row(0, 'The legacy exporter still runs on the old cluster.'), key: 'target-key' }
    const others = Array.from({ length: 14 }, (_, i) => row(i + 1, `Unrelated fact number ${i + 1} about the build.`))
    serve([target, ...others], { 'id-0': 'declared' }) // others: NULL evidence
    await recallCommand('The legacy exporter still runs on the old cluster.', { limit: '10' })
    const out = console_.logs.join('\n')
    expect(out).toContain('target-key')
    // With k=60, the 0.95 weight is worth about three ranks on a single list:
    // rank 1 x 0.95 = 0.01557 sits between rank 4 (0.01563) and rank 5 (0.01538).
    // So it is demoted a little, never partitioned below all 14.
    const order = printedKeys(console_.logs, ['target-key', ...others.map((o) => o.key)])
    expect(order.indexOf('target-key')).toBe(3)
  })

  it('a verified memory still outranks an inferred one answering the same question (0070 intent kept)', async () => {
    const weak = { ...row(1, 'The pool ceiling is probably around 100.'), key: 'weak-key' }
    const strong = { ...row(2, 'The pool ceiling is 40, confirmed against the running config.'), key: 'strong-key' }
    serve([weak, strong], { 'id-1': 'inferred', 'id-2': 'verified' })
    await recallCommand('pool ceiling', { limit: '10' })
    expect(printedKeys(console_.logs, ['weak-key', 'strong-key'])).toEqual(['strong-key', 'weak-key'])
  })
})
