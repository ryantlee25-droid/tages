'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'

interface Memory {
  id: string
  key: string
  value: string
  type: string
  source: string
  file_paths: string[]
  tags: string[]
  cross_system_refs: string[] | null
  created_at: string
  updated_at: string
}

interface GraphEdge {
  from: string
  to: string
}

interface GraphNode {
  key: string
  type: string
  refs: string[]
}

interface GraphStats {
  nodeCount: number
  edgeCount: number
  cycleCount: number
  orphanCount: number
}

function sanitize(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function buildGraphData(memories: Memory[]): {
  nodes: GraphNode[]
  edges: GraphEdge[]
  cycles: string[][]
  orphans: string[]
  stats: GraphStats
  mermaid: string
} {
  const keySet = new Set(memories.map(m => m.key))
  const nodes: GraphNode[] = memories.map(m => ({
    key: m.key,
    type: m.type,
    refs: (m.cross_system_refs || []).filter(r => keySet.has(r)),
  }))

  const edges: GraphEdge[] = []
  for (const node of nodes) {
    for (const ref of node.refs) {
      edges.push({ from: node.key, to: ref })
    }
  }

  // Cycle detection via DFS
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycles: string[][] = []
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.key, node.refs)
  }

  function dfs(key: string, path: string[]): void {
    visited.add(key)
    inStack.add(key)
    path.push(key)
    for (const neighbor of adjacency.get(key) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path)
      } else if (inStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor)
        cycles.push([...path.slice(cycleStart), neighbor])
      }
    }
    path.pop()
    inStack.delete(key)
  }

  for (const node of nodes) {
    if (!visited.has(node.key)) {
      dfs(node.key, [])
    }
  }

  // Orphan detection
  const referencedKeys = new Set(edges.map(e => e.to))
  const orphans = nodes
    .filter(n => n.refs.length === 0 && !referencedKeys.has(n.key))
    .map(n => n.key)

  // Mermaid
  const mermaidLines = ['graph TD']
  if (edges.length === 0 && nodes.length === 0) {
    mermaidLines.push('  empty[No memories with cross-system references]')
  } else {
    for (const edge of edges) {
      mermaidLines.push(`  ${sanitize(edge.from)} --> ${sanitize(edge.to)}`)
    }
    for (const orphan of orphans) {
      mermaidLines.push(`  ${sanitize(orphan)}`)
    }
  }

  return {
    nodes,
    edges,
    cycles,
    orphans,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      cycleCount: cycles.length,
      orphanCount: orphans.length,
    },
    mermaid: mermaidLines.join('\n'),
  }
}

export function MemoryGraphView({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Memory | null>(null)

  const supabase = createClient()

  useEffect(() => {
    loadMemories()
  }, [projectId])

  async function loadMemories() {
    setLoading(true)
    const { data } = await supabase
      .from('memories')
      .select('id, key, value, type, source, file_paths, tags, cross_system_refs, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('status', 'live')
      .order('updated_at', { ascending: false })
    setMemories(data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  const { nodes, edges, cycles, orphans, stats, mermaid } = buildGraphData(memories)
  const connectedKeys = new Set([...edges.map(e => e.from), ...edges.map(e => e.to)])
  const connectedNodes = nodes.filter(n => connectedKeys.has(n.key))

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Nodes', value: stats.nodeCount },
          { label: 'Edges', value: stats.edgeCount },
          { label: 'Cycles', value: stats.cycleCount, warn: stats.cycleCount > 0 },
          { label: 'Orphans', value: stats.orphanCount },
        ].map(({ label, value, warn }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-center">
            <p className={`text-2xl font-bold ${warn ? 'text-yellow-400' : 'text-white'}`}>{value}</p>
            <p className="mt-1 text-xs text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Mermaid diagram */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Diagram</h2>
        <pre className="overflow-x-auto rounded-md bg-zinc-950 p-4 text-xs text-zinc-300">
          <code>{`\`\`\`mermaid\n${mermaid}\n\`\`\``}</code>
        </pre>
        <p className="mt-2 text-xs text-zinc-600">
          Copy the code block above and paste into any Mermaid-compatible renderer.
        </p>
      </div>

      {/* Cycle warnings */}
      {cycles.length > 0 && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
          <h2 className="mb-2 text-sm font-medium text-yellow-400">Cycle Warnings ({cycles.length})</h2>
          <ul className="space-y-1">
            {cycles.map((cycle, i) => (
              <li key={i} className="text-xs text-yellow-300/80">
                {cycle.join(' \u2192 ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Connected nodes */}
      {connectedNodes.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Connected Nodes ({connectedNodes.length})</h2>
          <div className="space-y-1">
            {connectedNodes.map(node => {
              const mem = memories.find(m => m.key === node.key)
              const outgoing = node.refs
              const incoming = nodes.filter(n => n.refs.includes(node.key)).map(n => n.key)
              return (
                <button
                  key={node.key}
                  onClick={() => setSelected(mem || null)}
                  className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-zinc-800/50"
                >
                  <TypeBadge type={node.type} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{node.key}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {outgoing.length > 0 && (
                        <span className="mr-3">
                          <span className="text-zinc-600">refs: </span>
                          {outgoing.join(', ')}
                        </span>
                      )}
                      {incoming.length > 0 && (
                        <span>
                          <span className="text-zinc-600">referenced by: </span>
                          {incoming.join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Orphan section */}
      {orphans.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Orphan Nodes ({orphans.length})
            <span className="ml-2 text-xs font-normal text-zinc-600">no cross-system references</span>
          </h2>
          <div className="space-y-1 opacity-60">
            {orphans.map(orphanKey => {
              const mem = memories.find(m => m.key === orphanKey)
              const node = nodes.find(n => n.key === orphanKey)
              return (
                <button
                  key={orphanKey}
                  onClick={() => setSelected(mem || null)}
                  className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-zinc-800/50"
                >
                  <TypeBadge type={node?.type || 'pattern'} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{orphanKey}</p>
                    {mem && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {mem.value.length > 80 ? mem.value.slice(0, 80) + '...' : mem.value}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="rounded-lg border border-zinc-800 p-12 text-center">
          <p className="text-sm text-zinc-400">No memories with cross-system references yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Add <code className="rounded bg-zinc-800 px-1">crossSystemRefs</code> to memories to see the graph.
          </p>
        </div>
      )}

      {/* Memory detail sheet */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-md overflow-y-auto bg-zinc-900 p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-medium text-white">{selected.key}</h3>
                <div className="mt-1 flex items-center gap-2">
                  <TypeBadge type={selected.type} />
                  <span className="text-xs text-zinc-500">{selected.source}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-white">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-zinc-400">Value</label>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{selected.value}</p>
            </div>
            {selected.cross_system_refs && selected.cross_system_refs.length > 0 && (
              <div className="mt-4">
                <label className="text-xs font-medium text-zinc-400">Cross-System Refs</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selected.cross_system_refs.map(ref => (
                    <button
                      key={ref}
                      onClick={() => {
                        const refMem = memories.find(m => m.key === ref)
                        if (refMem) setSelected(refMem)
                      }}
                      className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-[#3BA3C7] hover:underline"
                    >
                      {ref}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {selected.tags && selected.tags.length > 0 && (
              <div className="mt-4">
                <label className="text-xs font-medium text-zinc-400">Tags</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {selected.tags.map(tag => (
                    <span key={tag} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{tag}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 text-xs text-zinc-500">
              <p>Updated: {new Date(selected.updated_at).toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Also export as MemoryGraph for backward compatibility
export { MemoryGraphView as MemoryGraph }
