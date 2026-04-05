'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Decision {
  id: string
  decision: string
  rationale: string | null
  files_affected: string[]
  agent_name: string | null
  commit_sha: string | null
  created_at: string
}

export function DecisionTimeline({
  projectId,
  gitRemote,
}: {
  projectId: string
  gitRemote?: string
}) {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('decision_log')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      setDecisions(data || [])
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

  function commitUrl(sha: string): string | null {
    if (!gitRemote) return null
    const clean = gitRemote.replace(/\.git$/, '')
    return `${clean}/commit/${sha}`
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (decisions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">No decisions recorded yet.</p>
      </div>
    )
  }

  return (
    <div className="relative space-y-4 pl-6">
      {/* Timeline line */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-zinc-800" />

      {decisions.map((d) => (
        <div key={d.id} className="relative">
          {/* Dot */}
          <div className="absolute -left-4 top-2 h-2.5 w-2.5 rounded-full border-2 border-purple-500 bg-zinc-950" />

          <div className="rounded-lg border border-zinc-800 p-4">
            <div className="flex items-start justify-between">
              <p className="text-sm font-medium text-white">{d.decision}</p>
              <span className="ml-3 shrink-0 text-xs text-zinc-500">
                {new Date(d.created_at).toLocaleDateString()}
              </span>
            </div>

            {d.rationale && (
              <div className="mt-2">
                <button
                  onClick={() => toggleExpand(d.id)}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  {expanded.has(d.id) ? 'Hide rationale' : 'Show rationale'}
                </button>
                {expanded.has(d.id) && (
                  <p className="mt-1 text-xs text-zinc-400">{d.rationale}</p>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {d.files_affected?.map((f) => (
                <span key={f} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {f}
                </span>
              ))}
              {d.agent_name && (
                <span className="text-[10px] text-zinc-500">by {d.agent_name}</span>
              )}
              {d.commit_sha && (
                commitUrl(d.commit_sha) ? (
                  <a
                    href={commitUrl(d.commit_sha)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 hover:underline"
                  >
                    {d.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="text-[10px] text-zinc-500">{d.commit_sha.slice(0, 7)}</span>
                )
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
