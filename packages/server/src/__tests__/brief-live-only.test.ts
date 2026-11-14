/**
 * 0.5.7 bug 4 (server): project_brief and the memory:// resources feed agent
 * context, so they must carry live rows only. Pending rows are unreviewed;
 * archived rows are retracted.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import { SqliteCache } from '../cache/sqlite'
import { handleBrief } from '../tools/brief'
import { registerResources } from '../resources'

const PROJECT = 'brief-live-only'
const TYPES: Memory['type'][] = ['convention', 'architecture', 'decision', 'entity', 'execution', 'lesson', 'pattern', 'anti_pattern']

function mem(type: Memory['type'], status: Memory['status'], token: string): Memory {
  const now = new Date().toISOString()
  return {
    id: randomUUID(), projectId: PROJECT, key: `${type}-${status}-${token}`, value: `${status.toUpperCase()}_${token} rule for ${type}`,
    type, source: 'agent', status, confidence: 1, filePaths: [], tags: [], createdAt: now, updatedAt: now,
  }
}

type Handler = (uri: URL, params: Record<string, string>) => Promise<{ contents: Array<{ text: string }> }>

describe('live-only agent context', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-brief-live-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
    for (const t of TYPES) {
      cache.upsertMemory(mem(t, 'live', t), false)
      cache.upsertMemory(mem(t, 'pending', t), false)
      cache.upsertMemory(mem(t, 'archived', t), false)
    }
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('project_brief includes live rows and omits pending and archived ones', async () => {
    const res = await handleBrief({ budget: 50_000 }, PROJECT, cache, null)
    const text = res.content[0].text
    expect(text).toContain('LIVE_convention')
    expect(text).not.toMatch(/PENDING_/)
    expect(text).not.toMatch(/ARCHIVED_/)
    // the header count is the live count, not all statuses
    expect(text).toContain(`${TYPES.length} memories`)
  })

  it('project_brief with only pending rows reports no memories', async () => {
    const other = 'only-pending'
    cache.upsertMemory({ ...mem('convention', 'pending', 'x'), projectId: other }, false)
    const res = await handleBrief({}, other, cache, null)
    expect(res.content[0].text).toMatch(/No memories stored/)
  })

  it('every memory:// resource omits pending and archived rows', async () => {
    const handlers = new Map<string, Handler>()
    const server = {
      resource: (name: string, _t: unknown, _m: unknown, h: Handler) => { handlers.set(name, h) },
    }
    registerResources(server as never, cache, null)
    expect(handlers.size).toBeGreaterThan(0)

    let sawLive = false
    for (const [name, h] of handlers) {
      const out = await h(new URL(`memory://project/${PROJECT}/${name}`), { id: PROJECT })
      const text = out.contents.map(c => c.text).join('\n')
      if (/LIVE_/.test(text)) sawLive = true
      expect(text, name).not.toMatch(/PENDING_/)
      expect(text, name).not.toMatch(/ARCHIVED_/)
    }
    expect(sawLive).toBe(true)
  })
})
