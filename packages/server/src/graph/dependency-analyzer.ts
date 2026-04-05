import type { Memory } from '@tages/shared'

export interface DependencyGraph {
  nodes: Map<string, Memory>
  edges: Map<string, Set<string>>  // key -> set of keys it references
  reverseEdges: Map<string, Set<string>>  // key -> set of keys that reference it
}

export interface GraphAnalysis {
  graph: DependencyGraph
  orphans: string[]          // keys with no refs and not referenced by anyone
  criticalPaths: string[][]  // longest dependency chains
  impactScores: Map<string, number>  // key -> downstream count
}

/**
 * Build a dependency graph from crossSystemRefs in a set of memories.
 */
export function buildDependencyGraph(memories: Memory[]): DependencyGraph {
  const nodes = new Map<string, Memory>()
  const edges = new Map<string, Set<string>>()
  const reverseEdges = new Map<string, Set<string>>()

  for (const mem of memories) {
    nodes.set(mem.key, mem)
    if (!edges.has(mem.key)) edges.set(mem.key, new Set())
    if (!reverseEdges.has(mem.key)) reverseEdges.set(mem.key, new Set())
  }

  // Build edges from crossSystemRefs
  for (const mem of memories) {
    for (const ref of mem.crossSystemRefs || []) {
      if (nodes.has(ref)) {
        edges.get(mem.key)!.add(ref)
        if (!reverseEdges.has(ref)) reverseEdges.set(ref, new Set())
        reverseEdges.get(ref)!.add(mem.key)
      }
    }
  }

  return { nodes, edges, reverseEdges }
}

/**
 * Find orphan memories: no outgoing refs AND no incoming refs.
 */
export function findOrphans(graph: DependencyGraph): string[] {
  const orphans: string[] = []
  for (const [key] of graph.nodes) {
    const hasOut = (graph.edges.get(key)?.size ?? 0) > 0
    const hasIn = (graph.reverseEdges.get(key)?.size ?? 0) > 0
    if (!hasOut && !hasIn) orphans.push(key)
  }
  return orphans
}

/**
 * Compute downstream impact: how many unique nodes can be reached
 * from each node by following reverse edges (who depends on this?).
 */
export function computeImpactScores(graph: DependencyGraph): Map<string, number> {
  const scores = new Map<string, number>()

  const countDownstream = (key: string, visited: Set<string>): number => {
    if (visited.has(key)) return 0
    visited.add(key)
    const dependents = graph.reverseEdges.get(key) ?? new Set()
    let count = dependents.size
    for (const dep of dependents) {
      count += countDownstream(dep, visited)
    }
    return count
  }

  for (const [key] of graph.nodes) {
    scores.set(key, countDownstream(key, new Set()))
  }

  return scores
}

/**
 * Find the longest dependency chains (critical paths).
 * Returns top 5 chains sorted by length.
 */
export function findCriticalPaths(graph: DependencyGraph): string[][] {
  const paths: string[][] = []

  const dfs = (key: string, path: string[], visited: Set<string>) => {
    visited.add(key)
    const refs = graph.edges.get(key) ?? new Set()
    const newRefs = [...refs].filter(r => !visited.has(r))

    if (newRefs.length === 0) {
      paths.push([...path])
    } else {
      for (const ref of newRefs) {
        dfs(ref, [...path, ref], new Set(visited))
      }
    }
  }

  for (const [key] of graph.nodes) {
    dfs(key, [key], new Set())
  }

  return paths
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
}

export function analyzeGraph(memories: Memory[]): GraphAnalysis {
  const graph = buildDependencyGraph(memories)
  const orphans = findOrphans(graph)
  const criticalPaths = findCriticalPaths(graph)
  const impactScores = computeImpactScores(graph)

  return { graph, orphans, criticalPaths, impactScores }
}
