import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { buildMemoryGraph, handleMemoryGraph } from '../tools/memory-graph'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-graph-project'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

function makeMemory(cache: SqliteCache, key: string, crossSystemRefs: string[] = []) {
  cache.upsertMemory({
    id: `id-${Math.random().toString(36).slice(2)}`,
    projectId: TEST_PROJECT,
    key,
    value: `value for ${key}`,
    type: 'architecture',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    crossSystemRefs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

describe('memory graph', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    const result = createTestCache()
    cache = result.cache
    dbPath = result.dbPath
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('builds graph from crossSystemRefs', () => {
    makeMemory(cache, 'auth-service', ['user-service', 'token-store'])
    makeMemory(cache, 'user-service')
    makeMemory(cache, 'token-store')
    const graph = buildMemoryGraph(TEST_PROJECT, cache)
    expect(graph.nodes.length).toBe(3)
    expect(graph.edges.length).toBe(2)
    const authNode = graph.nodes.find((n) => n.key === 'auth-service')
    expect(authNode?.refs).toContain('user-service')
  })

  it('detects cycles in the graph', () => {
    makeMemory(cache, 'node-a', ['node-b'])
    makeMemory(cache, 'node-b', ['node-c'])
    makeMemory(cache, 'node-c', ['node-a'])
    const graph = buildMemoryGraph(TEST_PROJECT, cache)
    expect(graph.cycles.length).toBeGreaterThan(0)
  })

  it('handles orphan nodes (no refs)', () => {
    makeMemory(cache, 'standalone-a')
    makeMemory(cache, 'standalone-b')
    const graph = buildMemoryGraph(TEST_PROJECT, cache)
    expect(graph.nodes.length).toBe(2)
    expect(graph.edges.length).toBe(0)
    expect(graph.cycles.length).toBe(0)
  })

  it('handles empty project', () => {
    const graph = buildMemoryGraph(TEST_PROJECT, cache)
    expect(graph.nodes.length).toBe(0)
    expect(graph.edges.length).toBe(0)
    expect(graph.mermaid).toContain('graph TD')
  })

  it('generates valid mermaid output format', () => {
    makeMemory(cache, 'svc-a', ['svc-b'])
    makeMemory(cache, 'svc-b')
    const graph = buildMemoryGraph(TEST_PROJECT, cache)
    expect(graph.mermaid).toMatch(/^graph TD/)
    expect(graph.mermaid).toContain('svc_a')
    expect(graph.mermaid).toContain('-->')
  })

  it('handleMemoryGraph returns mermaid code block', async () => {
    makeMemory(cache, 'api', ['db'])
    makeMemory(cache, 'db')
    const result = await handleMemoryGraph(TEST_PROJECT, cache)
    expect(result.content[0].text).toContain('```mermaid')
    expect(result.content[0].text).toContain('Memory Graph')
  })
})
