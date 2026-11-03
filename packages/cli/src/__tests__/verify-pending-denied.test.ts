import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { setupTempConfigDir, writeProjectConfig, captureConsole, TEST_PROJECT_CONFIG } from './helpers.js'

// Bug 5 (CLI): a read-only member's update is RLS-filtered to zero rows with
// no error. verify / pending --approve-all / --reject-all / settings auto-save
// must print the permission message and exit 1, never "Verified",
// "Approved N" or "set to 10%".
// Bug 1 (CLI): approval embeds promoted rows that have no embedding.

type Op = { method: string; args: unknown[] }
type Responder = (table: string, ops: Op[]) => { data: unknown; error: { message: string } | null }

const { state, mockGenerateChunkEmbeddings, mockGenerateEmbedding } = vi.hoisted(() => ({
  state: {
    responder: null as unknown as Responder,
    calls: [] as Array<{ table: string; ops: Op[] }>,
  },
  mockGenerateChunkEmbeddings: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
}))

/** A PostgREST-ish chain: every method records itself; awaiting asks the responder. */
function makeChain(table: string) {
  const ops: Op[] = []
  state.calls.push({ table, ops })
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'update', 'delete', 'insert', 'eq', 'in', 'or', 'order', 'limit', 'single']) {
    chain[m] = (...args: unknown[]) => {
      ops.push({ method: m, args })
      return chain
    }
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve()
      .then(() => state.responder(table, ops))
      .then(resolve, reject)
  return chain
}

const mockClient = {
  from: (table: string) => makeChain(table),
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } } }) },
}

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: vi.fn(async () => mockClient),
}))

vi.mock('../lib/embedding.js', () => ({
  generateChunkEmbeddings: mockGenerateChunkEmbeddings,
  generateEmbedding: mockGenerateEmbedding,
}))

let tempConfigDir: string
vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
  return { default: vi.fn(() => spinner) }
})

import ora from 'ora'
import { verifyCommand } from '../commands/verify.js'
import { pendingCommand } from '../commands/pending.js'
import { settingsAutoSaveCommand } from '../commands/settings.js'
import { embedPromoted } from '../lib/embed-promoted.js'

const has = (ops: Op[], method: string) => ops.some((o) => o.method === method)
const spinner = () => (ora as unknown as () => Record<string, ReturnType<typeof vi.fn>>)()
const updates = (table = 'memories') =>
  state.calls.filter((c) => c.table === table && has(c.ops, 'update'))

const VEC = Array.from({ length: 4 }, () => 0.5)

describe('CLI writes refuse silently-denied updates', () => {
  let console_: ReturnType<typeof captureConsole>
  let cleanup: () => void
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanup = setup.cleanup
    writeProjectConfig(tempConfigDir, TEST_PROJECT_CONFIG)
    console_ = captureConsole()
    vi.clearAllMocks()
    state.calls = []
    mockGenerateChunkEmbeddings.mockResolvedValue({ pooled: VEC, chunks: [] })
    mockGenerateEmbedding.mockResolvedValue(VEC)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    console_.restore()
    cleanup()
  })

  const allOutput = () => [...console_.logs, ...console_.errors].join('\n')
  const succeedText = () => spinner().succeed.mock.calls.map((c) => String(c[0])).join('\n')

  // ---- verify -------------------------------------------------------------

  /** A pending row; the update returns `updated`; embedding fetch returns `rows`. */
  function verifyResponder(updated: unknown[], rows: unknown[] = []): Responder {
    return (_t, ops) => {
      if (has(ops, 'single')) return { data: { id: 'm1', key: 'k1', type: 'convention', status: 'pending' }, error: null }
      if (has(ops, 'update')) return { data: updated, error: null }
      if (has(ops, 'in')) return { data: rows, error: null }
      return { data: [], error: null }
    }
  }

  it('verify: zero rows -> permission message, exit 1, no "Verified"', async () => {
    state.responder = verifyResponder([])
    await expect(verifyCommand('k1', {})).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(allOutput()).toContain('Permission denied: your role cannot verify memories')
    expect(succeedText()).not.toContain('Verified')
    expect(mockGenerateChunkEmbeddings).not.toHaveBeenCalled()
  })

  it('verify: chains .select() on the update', async () => {
    state.responder = verifyResponder([{ id: 'm1' }])
    await verifyCommand('k1', {})
    expect(has(updates()[0].ops, 'select')).toBe(true)
  })

  it('verify: success embeds a promoted row whose embedding is null', async () => {
    state.responder = verifyResponder([{ id: 'm1' }], [{ key: 'k1', value: 'use pnpm', embedding: null, encrypted: false }])
    await verifyCommand('k1', {})
    expect(succeedText()).toContain('Verified')
    expect(mockGenerateChunkEmbeddings).toHaveBeenCalledWith('use pnpm', expect.objectContaining({
      projectId: 'test-project-id',
      accessToken: 'jwt',
      supabaseUrl: 'https://test.supabase.co',
    }))
    const embedWrite = updates().find((c) => c.ops.some((o) => o.method === 'update' && 'embedding' in (o.args[0] as object)))
    expect(embedWrite).toBeDefined()
    expect((embedWrite!.ops.find((o) => o.method === 'update')!.args[0] as { embedding: string }).embedding).toBe('[0.5,0.5,0.5,0.5]')
  })

  it('verify: embedding failure is a warning, approval still succeeds', async () => {
    state.responder = verifyResponder([{ id: 'm1' }], [{ key: 'k1', value: 'v', embedding: null }])
    mockGenerateChunkEmbeddings.mockRejectedValue(new Error('hosted down'))
    mockGenerateEmbedding.mockResolvedValue(null)
    await verifyCommand('k1', {})
    expect(exitSpy).not.toHaveBeenCalled()
    expect(succeedText()).toContain('Verified')
    expect(console_.errors.join('\n')).toMatch(/no embedding yet/)
  })

  // ---- pending --approve-all / --reject-all -------------------------------

  const PENDING = [
    { id: 'id-1', key: 'k1', type: 'convention', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: [] },
    { id: 'id-2', key: 'k2', type: 'decision', confidence: 0.9, created_at: '2026-04-18T00:00:00Z', tags: [] },
  ]

  function pendingResponder(updated: unknown[], rows: unknown[] = []): Responder {
    return (_t, ops) => {
      if (has(ops, 'update')) return { data: updated, error: null }
      if (has(ops, 'order')) return { data: PENDING, error: null }
      if (has(ops, 'in')) return { data: rows, error: null }
      return { data: [], error: null }
    }
  }

  it('approve-all: zero rows -> permission message, exit 1, no "Approved"', async () => {
    state.responder = pendingResponder([])
    await expect(pendingCommand({ approveAll: true, yes: true })).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(allOutput()).toContain('Permission denied: your role cannot approve memories')
    expect(succeedText()).not.toContain('Approved')
    expect(mockGenerateChunkEmbeddings).not.toHaveBeenCalled()
  })

  it('approve-all: partial -> "Only 1 of 2", exit 1, still embeds the approved one', async () => {
    state.responder = pendingResponder(
      [{ id: 'id-1', key: 'k1' }],
      [{ key: 'k1', value: 'v1', embedding: null }],
    )
    await expect(pendingCommand({ approveAll: true, yes: true })).rejects.toThrow('process.exit called')
    expect(allOutput()).toContain('Only 1 of 2 changed')
    expect(succeedText()).not.toContain('Approved')
    expect(mockGenerateChunkEmbeddings).toHaveBeenCalledTimes(1)
  })

  it('approve-all: owner path embeds only rows with a null embedding', async () => {
    state.responder = pendingResponder(
      [{ id: 'id-1', key: 'k1' }, { id: 'id-2', key: 'k2' }],
      [
        { key: 'k1', value: 'needs one', embedding: null },
        { key: 'k2', value: 'has one', embedding: '[0.1,0.2]' },
      ],
    )
    await pendingCommand({ approveAll: true, yes: true })
    expect(succeedText()).toContain('Approved 2')
    expect(mockGenerateChunkEmbeddings).toHaveBeenCalledTimes(1)
    expect(mockGenerateChunkEmbeddings).toHaveBeenCalledWith('needs one', expect.any(Object))
  })

  it('reject-all: zero rows -> permission message, exit 1, no "Archived"', async () => {
    state.responder = pendingResponder([])
    await expect(pendingCommand({ rejectAll: true, yes: true })).rejects.toThrow('process.exit called')
    expect(allOutput()).toContain('Permission denied: your role cannot archive memories')
    expect(succeedText()).not.toContain('Archived')
  })

  // ---- settings auto-save --------------------------------------------------

  it('settings auto-save: zero rows -> permission message, exit 1, no "set to 10%"', async () => {
    state.responder = (_t, ops) => {
      if (has(ops, 'update')) return { data: [], error: null }
      return { data: { name: 'Test', auto_save_threshold: null }, error: null }
    }
    await expect(settingsAutoSaveCommand('0.1', { yes: true })).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(allOutput()).toContain('Permission denied: your role cannot change the auto-save threshold')
    expect(succeedText()).not.toContain('set to')
    expect(has(updates('projects')[0].ops, 'select')).toBe(true)
  })

  it('settings auto-save: owner success still reports the new threshold', async () => {
    state.responder = (_t, ops) => {
      if (has(ops, 'update')) return { data: [{ id: 'test-project-id' }], error: null }
      return { data: { name: 'Test' }, error: null }
    }
    await settingsAutoSaveCommand('0.85', { yes: true })
    expect(succeedText()).toContain('85%')
  })
})

describe('embedPromoted', () => {
  let console_: ReturnType<typeof captureConsole>
  beforeEach(() => {
    console_ = captureConsole()
    vi.clearAllMocks()
    state.calls = []
    mockGenerateChunkEmbeddings.mockResolvedValue({ pooled: VEC, chunks: [] })
    mockGenerateEmbedding.mockResolvedValue(VEC)
  })
  afterEach(() => console_.restore())

  const client = mockClient as unknown as Parameters<typeof embedPromoted>[0]

  it('skips encrypted rows and rows that already have an embedding', async () => {
    state.responder = (_t, ops) =>
      has(ops, 'update')
        ? { data: [{ id: 'x' }], error: null }
        : {
            data: [
              { key: 'a', value: 'plain', embedding: null, encrypted: false },
              { key: 'b', value: 'ciphertext', embedding: null, encrypted: true },
              { key: 'c', value: 'done', embedding: '[1]', encrypted: false },
            ],
            error: null,
          }
    const r = await embedPromoted(client, 'p', ['a', 'b', 'c'])
    expect(r).toEqual({ embedded: 1, failed: 0 })
    expect(mockGenerateChunkEmbeddings).toHaveBeenCalledTimes(1)
  })

  it('falls back to generateEmbedding when the chunk pass yields nothing', async () => {
    mockGenerateChunkEmbeddings.mockResolvedValue(null)
    state.responder = (_t, ops) =>
      has(ops, 'update') ? { data: [{ id: 'x' }], error: null } : { data: [{ key: 'a', value: 'v', embedding: null }], error: null }
    const r = await embedPromoted(client, 'p', ['a'])
    expect(mockGenerateEmbedding).toHaveBeenCalledWith('v')
    expect(r.embedded).toBe(1)
  })

  it('never throws: a failed fetch is a warning', async () => {
    state.responder = () => ({ data: null, error: { message: 'db down' } })
    const r = await embedPromoted(client, 'p', ['a', 'b'])
    expect(r).toEqual({ embedded: 0, failed: 2 })
    expect(console_.errors.join('\n')).toContain('db down')
  })

  it('counts a zero-row embedding write as failed', async () => {
    state.responder = (_t, ops) =>
      has(ops, 'update') ? { data: [], error: null } : { data: [{ key: 'a', value: 'v', embedding: null }], error: null }
    const r = await embedPromoted(client, 'p', ['a'])
    expect(r).toEqual({ embedded: 0, failed: 1 })
  })

  it('respects the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    mockGenerateChunkEmbeddings.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { pooled: VEC, chunks: [] }
    })
    const rows = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, value: `v${i}`, embedding: null }))
    state.responder = (_t, ops) => (has(ops, 'update') ? { data: [{ id: 'x' }], error: null } : { data: rows, error: null })
    const r = await embedPromoted(client, 'p', rows.map((x) => x.key), { concurrency: 3 })
    expect(r.embedded).toBe(10)
    expect(peak).toBeLessThanOrEqual(3)
  })
})
