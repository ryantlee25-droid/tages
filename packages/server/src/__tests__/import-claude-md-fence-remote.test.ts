/**
 * 0.5.7 bug 8 (+ bug 1 for imports): import_claude_md strips fences BEFORE
 * splitting on headings, judges `skip`/`overwrite` against the shared store,
 * pushes immediately, and embeds every written row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const order: string[] = []
vi.mock('../tools/embed-on-write', () => ({
  embedOnWrite: vi.fn(async (memory: Memory) => { order.push(`embed:${memory.key}`) }),
}))

import { embedOnWrite } from '../tools/embed-on-write'
import { handleImportClaudeMd, parseClaudeMd, stripFencedCode } from '../tools/import-claude-md'

const mockEmbed = vi.mocked(embedOnWrite)
const PROJECT = 'import-fence-remote'
const OWNER = 'owner-user-id'
const TEAMMATE = 'teammate-user-id'

const DOC = [
  '## Conventions',
  '- Always prefix fixture ids with the run id so cleanup finds them.',
  '- Use pnpm workspaces for every package in the repo.',
  '',
  '## Architecture',
  '- The ingest worker lives in services/ingest and reads from NATS.',
  '',
].join('\n')

describe('parseClaudeMd fence handling', () => {
  it('a heading inside a ``` fence neither splits the section nor leaks', () => {
    const md = ['## Conventions', '- Real rule that is long enough.', '```md', '## Example output', '- FENCE_SENTINEL item', '```', ''].join('\n')
    const items = parseClaudeMd(md)
    expect(items.map(i => i.value)).toEqual(['Real rule that is long enough.'])
    expect(items.every(i => i.type === 'convention')).toBe(true)
  })

  it('a ~~~ fence is stripped too', () => {
    const md = ['## Rules', '- Kept rule here.', '~~~', '## Decisions', '- TILDE_SENTINEL', '~~~', '- Second kept rule.'].join('\n')
    const items = parseClaudeMd(md)
    expect(items.map(i => i.value)).toEqual(['Kept rule here.', 'Second kept rule.'])
  })

  it('a ~~~ line does not close a ``` fence', () => {
    const md = ['## Rules', '- Kept.', '```', '~~~', '- MIXED_SENTINEL', '```', '- After.'].join('\n')
    expect(parseClaudeMd(md).map(i => i.value)).toEqual(['Kept.', 'After.'])
  })

  it('an unclosed fence strips to the end of the document', () => {
    const md = ['## Rules', '- Kept rule.', '```ts', '## Not a heading', '- UNCLOSED_SENTINEL'].join('\n')
    const items = parseClaudeMd(md)
    expect(items.map(i => i.value)).toEqual(['Kept rule.'])
    expect(stripFencedCode(md)).not.toContain('UNCLOSED_SENTINEL')
  })
})

function remoteRow(key: string, value: string, over: Partial<Memory> = {}): Memory {
  return {
    id: `remote-${key}`, projectId: PROJECT, key, value, type: 'convention', source: 'import',
    status: 'live', confidence: 1, filePaths: [], tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: OWNER, updatedBy: OWNER, ...over,
  }
}

function makeSync(remote: Map<string, Memory> | null) {
  return {
    remoteGetByKeys: vi.fn(async () => remote),
    remoteInsert: vi.fn(async (m: Memory) => { order.push(`insert:${m.key}`); return true }),
    remoteClearEmbedding: vi.fn(async () => true),
  } as unknown as SupabaseSync & { remoteGetByKeys: ReturnType<typeof vi.fn>; remoteInsert: ReturnType<typeof vi.fn> }
}

describe('handleImportClaudeMd against the shared store', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    order.length = 0
    mockEmbed.mockClear()
    dbPath = path.join(os.tmpdir(), `tages-import-remote-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('fresh import pushes every row immediately, then embeds it', async () => {
    const sync = makeSync(new Map())
    const res = await handleImportClaudeMd({ content: DOC, projectId: PROJECT }, cache, sync, OWNER)
    expect(res.content[0].text).toBe('Imported 3 memories (0 skipped)')
    expect(sync.remoteInsert).toHaveBeenCalledTimes(3)
    expect(mockEmbed).toHaveBeenCalledTimes(3)
    for (const item of parseClaudeMd(DOC)) {
      expect(order.indexOf(`insert:${item.key}`)).toBeLessThan(order.indexOf(`embed:${item.key}`))
      expect(mockEmbed.mock.calls.find(c => c[0].key === item.key)![1]).toBe(item.value)
    }
    // pushed rows are marked synced, not left for the 60s flush
    expect(cache.getDirty().filter(m => m.projectId === PROJECT)).toHaveLength(0)
  })

  it("skip: a teammate whose cache is empty skips rows that exist remotely, and the cache is seeded with the owner's id and created_by", async () => {
    const items = parseClaudeMd(DOC)
    const remote = new Map(items.map(i => [i.key, remoteRow(i.key, i.value)]))
    const sync = makeSync(remote)

    const res = await handleImportClaudeMd({ content: DOC, projectId: PROJECT, strategy: 'skip' }, cache, sync, TEAMMATE)

    expect(res.content[0].text).toBe('Imported 0 memories (3 skipped)')
    expect(sync.remoteGetByKeys).toHaveBeenCalledWith(PROJECT, items.map(i => i.key))
    expect(sync.remoteInsert).not.toHaveBeenCalled()
    expect(mockEmbed).not.toHaveBeenCalled()
    for (const i of items) {
      const seeded = cache.getByKey(PROJECT, i.key)!
      expect(seeded.id).toBe(`remote-${i.key}`)
      expect(seeded.createdBy).toBe(OWNER)
    }
    expect(cache.getDirty().filter(m => m.projectId === PROJECT)).toHaveLength(0)
  })

  it('skip: only the remote-missing rows are imported', async () => {
    const items = parseClaudeMd(DOC)
    const remote = new Map([[items[0].key, remoteRow(items[0].key, items[0].value)]])
    const res = await handleImportClaudeMd({ content: DOC, projectId: PROJECT }, cache, makeSync(remote), TEAMMATE)
    expect(res.content[0].text).toBe('Imported 2 memories (1 skipped)')
  })

  it("overwrite keeps the remote row's id and created_by and stamps updated_by", async () => {
    const items = parseClaudeMd(DOC)
    const target = items[0]
    const remote = new Map([[target.key, remoteRow(target.key, 'old text', { encrypted: true })]])
    const sync = makeSync(remote)
    const edited = DOC.replace(target.value, target.value) // same key, overwrite with file text

    await handleImportClaudeMd({ content: edited, projectId: PROJECT, strategy: 'overwrite' }, cache, sync, TEAMMATE)

    const pushed = (sync.remoteInsert.mock.calls.map(c => c[0]) as Memory[]).find(m => m.key === target.key)!
    expect(pushed.id).toBe(`remote-${target.key}`)
    expect(pushed.createdBy).toBe(OWNER)
    expect(pushed.updatedBy).toBe(TEAMMATE)
    expect(pushed.value).toBe(target.value)
    expect(pushed.encrypted).toBe(false)
    expect(cache.getByKey(PROJECT, target.key)!.id).toBe(`remote-${target.key}`)
  })

  it('overwrite with changed text clears the old vector locally and remotely; unchanged text keeps it', async () => {
    const items = parseClaudeMd(DOC)
    const [changed, same] = items
    cache.upsertMemoryWithEmbedding({ ...remoteRow(changed.key, 'old text'), projectId: PROJECT } as Memory, [1, 2, 3], false)
    cache.upsertMemoryWithEmbedding({ ...remoteRow(same.key, same.value), projectId: PROJECT } as Memory, [4, 5, 6], false)
    const sync = makeSync(new Map())
    // Leave every row past the embed deadline so only the clear is observed.
    mockEmbed.mockImplementation(async () => {})
    await handleImportClaudeMd({ content: DOC, projectId: PROJECT, strategy: 'overwrite' }, cache, sync, TEAMMATE)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emb = (key: string) => ((cache as any).db.prepare('SELECT embedding FROM memories WHERE project_id = ? AND key = ?').get(PROJECT, key) as { embedding: string | null }).embedding
    expect(emb(changed.key)).toBeNull()
    expect(emb(same.key)).toBe('[4,5,6]')
    const cleared = (sync as unknown as { remoteClearEmbedding: ReturnType<typeof vi.fn> }).remoteClearEmbedding.mock.calls.map(c => c[1])
    expect(cleared).toEqual([changed.key])
  })

  it('remote lookup unavailable: falls back to the local cache and says so', async () => {
    const res = await handleImportClaudeMd({ content: DOC, projectId: PROJECT }, cache, makeSync(null), OWNER)
    expect(res.content[0].text).toMatch(/^Imported 3 memories \(0 skipped\)/)
    expect(res.content[0].text).toMatch(/judged against this machine's cache only/)
  })

  it('no sync (local-only project): imports locally, no fallback note', async () => {
    const res = await handleImportClaudeMd({ content: DOC, projectId: PROJECT }, cache, null, OWNER)
    expect(res.content[0].text).toBe('Imported 3 memories (0 skipped)')
    expect(mockEmbed).toHaveBeenCalledTimes(3)
  })
})
