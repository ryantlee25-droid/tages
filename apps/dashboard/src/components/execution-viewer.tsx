'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ExecutionFlow {
  trigger: string
  steps: string[]
  phases?: string[]
  hooks?: string[]
}

interface ExecutionMemory {
  id: string
  key: string
  value: string
  agent_name: string | null
  confidence: number
  created_at: string
  execution_flow: ExecutionFlow | null
  conditions: string[] | null
  phases: string[] | null
}

export function ExecutionViewer({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<ExecutionMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('memories')
        .select('id, key, value, agent_name, confidence, created_at, execution_flow, conditions, phases')
        .eq('project_id', projectId)
        .eq('type', 'execution')
        .eq('status', 'live')
        .order('created_at', { ascending: false })
      setMemories((data || []).map((m) => ({
        ...m,
        execution_flow: m.execution_flow
          ? (typeof m.execution_flow === 'string' ? JSON.parse(m.execution_flow) : m.execution_flow)
          : null,
        conditions: m.conditions
          ? (typeof m.conditions === 'string' ? JSON.parse(m.conditions) : m.conditions)
          : null,
        phases: m.phases
          ? (typeof m.phases === 'string' ? JSON.parse(m.phases) : m.phases)
          : null,
      })))
      setLoading(false)
    }
    load()
  }, [projectId])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">No execution flows recorded yet.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Use <code className="rounded bg-zinc-800 px-1">type: execution</code> with an{' '}
          <code className="rounded bg-zinc-800 px-1">executionFlow</code> when storing memories.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {memories.map((memory) => {
        const flow = memory.execution_flow
        const isExpanded = expanded.has(memory.id)

        return (
          <div key={memory.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{memory.key}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{memory.value}</p>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-3">
                {memory.agent_name && (
                  <span className="text-[10px] text-zinc-500">{memory.agent_name}</span>
                )}
                <span className="text-xs text-zinc-600">
                  {new Date(memory.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => toggleExpand(memory.id)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {isExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            {/* Flow visualization */}
            {flow && (
              <div className="mt-3">
                {/* Trigger → steps flow */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Trigger node */}
                  <span className="rounded-md bg-[#3BA3C7]/10 px-2.5 py-1 text-xs font-medium text-[#3BA3C7] border border-[#3BA3C7]/20">
                    {flow.trigger}
                  </span>

                  {flow.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      {/* Arrow */}
                      <svg className="h-3 w-3 shrink-0 text-zinc-600" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {/* Step node */}
                      <span className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 border border-zinc-700">
                        {step}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                    {flow.phases && flow.phases.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Phases</p>
                        <div className="flex flex-wrap gap-1.5">
                          {flow.phases.map((phase, i) => (
                            <span key={i} className="rounded bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-400 border border-purple-500/20">
                              {phase}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {flow.hooks && flow.hooks.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Hooks</p>
                        <div className="flex flex-wrap gap-1.5">
                          {flow.hooks.map((hook, i) => (
                            <span key={i} className="rounded bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-400 border border-orange-500/20">
                              {hook}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {memory.conditions && memory.conditions.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Conditions</p>
                        <ul className="space-y-0.5">
                          {memory.conditions.map((c, i) => (
                            <li key={i} className="text-xs text-zinc-400">• {c}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {memory.phases && memory.phases.length > 0 && (
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Memory Phases</p>
                        <div className="flex flex-wrap gap-1.5">
                          {memory.phases.map((phase, i) => (
                            <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                              {phase}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
