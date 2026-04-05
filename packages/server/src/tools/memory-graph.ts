import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

interface GraphNode {
  key: string
  type: string
  refs: string[]
}

interface GraphResult {
  nodes: GraphNode[]
  edges: Array<{ from: string; to: string }>
  cycles: string[][]
  mermaid: string
}

function sanitizeMermaidId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, '_')
}

function detectCycles(adjacency: Map<string, string[]>): string[][] {
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycles: string[][] = []

  function dfs(node: string, path: string[]): void {
    visited.add(node)
    inStack.add(node)

    const neighbors = adjacency.get(node) || []
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor])
      } else if (inStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor)
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart))
        } else {
          cycles.push([...path, neighbor])
        }
      }
    }

    inStack.delete(node)
  }

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) {
      dfs(node, [node])
    }
  }

  return cycles
}

export function buildMemoryGraph(projectId: string, cache: SqliteCache): GraphResult {
  const all = cache.getAllForProject(projectId).filter((m) => m.status === 'live')

  // Build key → memory map
  const keyMap = new Map(all.map((m) => [m.key, m]))

  // Build adjacency list from crossSystemRefs
  const nodes: GraphNode[] = []
  const edges: Array<{ from: string; to: string }> = []
  const adjacency = new Map<string, string[]>()

  for (const memory of all) {
    const refs = (memory.crossSystemRefs || []).filter((r) => keyMap.has(r))
    nodes.push({ key: memory.key, type: memory.type, refs })

    if (refs.length > 0) {
      adjacency.set(memory.key, refs)
      for (const ref of refs) {
        edges.push({ from: memory.key, to: ref })
      }
    }
  }

  const cycles = detectCycles(adjacency)

  // Generate mermaid diagram
  const mermaidLines = ['graph TD']
  const addedNodes = new Set<string>()

  for (const node of nodes) {
    if (!addedNodes.has(node.key)) {
      const safeId = sanitizeMermaidId(node.key)
      mermaidLines.push(`  ${safeId}["${node.key} [${node.type}]"]`)
      addedNodes.add(node.key)
    }
  }

  for (const edge of edges) {
    const fromId = sanitizeMermaidId(edge.from)
    const toId = sanitizeMermaidId(edge.to)
    mermaidLines.push(`  ${fromId} --> ${toId}`)
  }

  // Mark cycle nodes
  for (const cycle of cycles) {
    for (const node of cycle) {
      const safeId = sanitizeMermaidId(node)
      mermaidLines.push(`  style ${safeId} fill:#ff6b6b,stroke:#cc0000`)
    }
  }

  const mermaid = mermaidLines.join('\n')

  return { nodes, edges, cycles, mermaid }
}

export async function handleMemoryGraph(
  projectId: string,
  cache: SqliteCache,
  _sync?: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const graph = buildMemoryGraph(projectId, cache)

  if (graph.nodes.length === 0) {
    return {
      content: [{ type: 'text', text: 'No memories found for this project.' }],
    }
  }

  const connectedNodes = graph.nodes.filter((n) => n.refs.length > 0)
  const orphanNodes = graph.nodes.filter((n) => n.refs.length === 0)

  const cycleWarning = graph.cycles.length > 0
    ? `\n\n⚠ Cycles detected: ${graph.cycles.map((c) => c.join(' → ')).join('; ')}`
    : ''

  return {
    content: [{
      type: 'text',
      text: [
        `## Memory Graph`,
        ``,
        `Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length} | Connected: ${connectedNodes.length} | Orphans: ${orphanNodes.length}${cycleWarning}`,
        ``,
        `\`\`\`mermaid`,
        graph.mermaid,
        `\`\`\``,
      ].join('\n'),
    }],
  }
}
