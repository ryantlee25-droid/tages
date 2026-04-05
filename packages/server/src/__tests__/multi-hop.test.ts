import { describe, it, expect } from 'vitest'
import { expandRecall, buildAdjacencyFromRefs } from '../search/multi-hop'
import type { Memory } from '@tages/shared'

function makeMemory(key: string, refs: string[] = [], conf = 1.0): Memory {
  return {
    id: `id-${key}`,
    projectId: 'proj-1',
    key,
    value: `value for ${key}`,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: conf,
    filePaths: [],
    tags: [],
    crossSystemRefs: refs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('buildAdjacencyFromRefs', () => {
  it('builds adjacency map from crossSystemRefs', () => {
    const memories = [
      makeMemory('a', ['b', 'c']),
      makeMemory('b', ['c']),
      makeMemory('c'),
    ]
    const adj = buildAdjacencyFromRefs(memories)
    expect(adj.get('a')).toEqual(['b', 'c'])
    expect(adj.get('b')).toEqual(['c'])
    expect(adj.has('c')).toBe(false) // no refs
  })

  it('excludes memories with no refs', () => {
    const memories = [makeMemory('x'), makeMemory('y')]
    const adj = buildAdjacencyFromRefs(memories)
    expect(adj.size).toBe(0)
  })
})

describe('expandRecall', () => {
  it('depth=0 returns original seeds', () => {
    const seeds = [makeMemory('a', ['b'])]
    const all = [makeMemory('a', ['b']), makeMemory('b')]
    const result = expandRecall(seeds, all, 0)
    expect(result.length).toBe(1)
    expect(result[0].key).toBe('a')
  })

  it('1-hop returns direct neighbors', () => {
    const a = makeMemory('a', ['b', 'c'])
    const b = makeMemory('b')
    const c = makeMemory('c')
    const all = [a, b, c]
    const result = expandRecall([a], all, 1)
    const keys = result.map(m => m.key)
    expect(keys).toContain('a')
    expect(keys).toContain('b')
    expect(keys).toContain('c')
  })

  it('2-hop returns neighbors-of-neighbors', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', ['c'])
    const c = makeMemory('c', ['d'])
    const d = makeMemory('d')
    const all = [a, b, c, d]
    const result = expandRecall([a], all, 2)
    const keys = result.map(m => m.key)
    expect(keys).toContain('a')
    expect(keys).toContain('b')
    expect(keys).toContain('c')
    // d is 3 hops away, should NOT be included with depth=2
    expect(keys).not.toContain('d')
  })

  it('cycle-safe BFS: does not loop infinitely', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', ['a']) // cycle
    const all = [a, b]
    const result = expandRecall([a], all, 5)
    const keys = result.map(m => m.key)
    // Should have each node exactly once
    expect(keys.filter(k => k === 'a').length).toBe(1)
    expect(keys.filter(k => k === 'b').length).toBe(1)
  })

  it('relevance ranking: seeds come before neighbors', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', ['c'])
    const c = makeMemory('c')
    const all = [a, b, c]
    const result = expandRecall([a], all, 2)
    expect(result[0].key).toBe('a') // seed first
  })

  it('orphans excluded: memories not reachable from seeds', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b')
    const orphan = makeMemory('orphan') // not referenced
    const all = [a, b, orphan]
    const result = expandRecall([a], all, 1)
    const keys = result.map(m => m.key)
    expect(keys).not.toContain('orphan')
  })

  it('higher confidence neighbors ranked first within same hop', () => {
    const a = makeMemory('a', ['high-conf', 'low-conf'])
    const highConf = makeMemory('high-conf', [], 0.95)
    const lowConf = makeMemory('low-conf', [], 0.3)
    const all = [a, highConf, lowConf]
    const result = expandRecall([a], all, 1)
    // hop 1 results should have high-conf before low-conf
    const hop1 = result.filter(m => m.key !== 'a')
    expect(hop1[0].key).toBe('high-conf')
  })

  it('empty seeds returns empty', () => {
    const all = [makeMemory('a', ['b']), makeMemory('b')]
    const result = expandRecall([], all, 2)
    expect(result).toEqual([])
  })
})
