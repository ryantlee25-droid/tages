import { describe, it, expect } from 'vitest'
import { buildDependencyGraph, findOrphans, computeImpactScores, findCriticalPaths } from '../graph/dependency-analyzer'
import { computeRisk, computeImpactReport, computeProjectRisk } from '../graph/impact-scorer'
import type { Memory } from '@tages/shared'

const PROJECT = 'impact-test'

function makeMemory(key: string, refs: string[] = [], overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value: `value for ${key}`,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    crossSystemRefs: refs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('buildDependencyGraph', () => {
  it('builds edges from crossSystemRefs', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', [])
    const graph = buildDependencyGraph([a, b])
    expect(graph.edges.get('a')?.has('b')).toBe(true)
    expect(graph.reverseEdges.get('b')?.has('a')).toBe(true)
  })

  it('ignores refs to unknown keys', () => {
    const a = makeMemory('a', ['unknown-key'])
    const graph = buildDependencyGraph([a])
    expect(graph.edges.get('a')?.size).toBe(0)
  })

  it('handles empty memories list', () => {
    const graph = buildDependencyGraph([])
    expect(graph.nodes.size).toBe(0)
  })
})

describe('findOrphans', () => {
  it('identifies memories with no refs', () => {
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const graph = buildDependencyGraph([a, b])
    const orphans = findOrphans(graph)
    // b -> a, so neither is truly orphaned (b has outgoing, a has incoming)
    expect(orphans).not.toContain('a')
    expect(orphans).not.toContain('b')
  })

  it('detects isolated memory as orphan', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', [])
    const c = makeMemory('c', [])
    const graph = buildDependencyGraph([a, b, c])
    const orphans = findOrphans(graph)
    // c has no edges at all
    expect(orphans).toContain('c')
  })
})

describe('computeImpactScores', () => {
  it('linear chain: root has highest impact', () => {
    // c -> b -> a (a is referenced by b, b by c)
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const c = makeMemory('c', ['b'])
    const graph = buildDependencyGraph([a, b, c])
    const scores = computeImpactScores(graph)
    // a is referenced by b and c (transitively), so impact = 2
    expect(scores.get('a')).toBe(2)
    expect(scores.get('b')).toBe(1)
    expect(scores.get('c')).toBe(0)
  })

  it('diamond dependency: shared node has high impact', () => {
    // Both b and c reference a; d references b and c
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const c = makeMemory('c', ['a'])
    const d = makeMemory('d', ['b', 'c'])
    const graph = buildDependencyGraph([a, b, c, d])
    const scores = computeImpactScores(graph)
    // a is referenced by b, c, and d (transitively)
    expect(scores.get('a')).toBeGreaterThan(2)
  })

  it('isolated memory has zero impact', () => {
    const a = makeMemory('a', [])
    const graph = buildDependencyGraph([a])
    const scores = computeImpactScores(graph)
    expect(scores.get('a')).toBe(0)
  })
})

describe('computeRisk', () => {
  it('higher impact = higher risk', () => {
    const mem = makeMemory('a', [], { confidence: 0.8 })
    const lowImpact = computeRisk(mem, 0)
    const highImpact = computeRisk(mem, 10)
    expect(highImpact).toBeGreaterThan(lowImpact)
  })

  it('low confidence increases risk', () => {
    const highConf = makeMemory('a', [], { confidence: 1.0 })
    const lowConf = makeMemory('a', [], { confidence: 0.1 })
    expect(computeRisk(lowConf, 5)).toBeGreaterThan(computeRisk(highConf, 5))
  })

  it('stale memory has higher risk', () => {
    const old = makeMemory('a', [], { updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() })
    const fresh = makeMemory('a', [], { updatedAt: new Date().toISOString() })
    expect(computeRisk(old, 5)).toBeGreaterThan(computeRisk(fresh, 5))
  })
})

describe('computeImpactReport', () => {
  it('returns correct direct dependents', () => {
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const c = makeMemory('c', ['a'])
    const report = computeImpactReport(a, [a, b, c])
    expect(report.directDependents).toContain('b')
    expect(report.directDependents).toContain('c')
    expect(report.transitiveCount).toBe(2)
  })

  it('returns low risk for isolated memory', () => {
    const a = makeMemory('a', [])
    const report = computeImpactReport(a, [a])
    expect(report.riskLevel).toBe('low')
    expect(report.transitiveCount).toBe(0)
  })
})

describe('computeProjectRisk', () => {
  it('returns all memories ranked by risk', () => {
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const c = makeMemory('c', ['b'])
    const report = computeProjectRisk([a, b, c])
    expect(report.totalMemories).toBe(3)
    expect(report.rankedByRisk[0].key).toBe('a') // a has highest impact
  })

  it('counts orphans correctly', () => {
    const a = makeMemory('a', [])
    const b = makeMemory('b', ['a'])
    const c = makeMemory('c', []) // orphan
    const report = computeProjectRisk([a, b, c])
    expect(report.orphanCount).toBe(1)
  })

  it('handles empty memories', () => {
    const report = computeProjectRisk([])
    expect(report.totalMemories).toBe(0)
    expect(report.rankedByRisk).toEqual([])
  })
})

describe('findCriticalPaths', () => {
  it('finds longest dependency chain', () => {
    const a = makeMemory('a', ['b'])
    const b = makeMemory('b', ['c'])
    const c = makeMemory('c', [])
    const graph = buildDependencyGraph([a, b, c])
    const paths = findCriticalPaths(graph)
    expect(paths.length).toBeGreaterThan(0)
    // Longest path should be 3 nodes: a -> b -> c
    expect(paths[0].length).toBe(3)
  })
})
