'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'

interface PendingMemory {
  id: string
  key: string
  value: string
  type: string
  source: string
  agent_name: string | null
  confidence: number
  created_at: string
}

export function PendingQueue({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<PendingMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<Set<string>>(new Set())

  const supabase = createClient()

  useEffect(() => {
    loadPending()

    const channel = supabase
      .channel('pending-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'memories',
          filter: `project_id=eq.${projectId}`,
        },
        () => loadPending(),
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  async function loadPending() {
    setLoading(true)
    const { data } = await supabase
      .from('memories')
      .select('id, key, value, type, source, agent_name, confidence, created_at')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setMemories(data || [])
    setLoading(false)
  }

  async function verify(id: string) {
    setProcessing((prev) => new Set(prev).add(id))
    await supabase
      .from('memories')
      .update({ status: 'live', verified_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
    setProcessing((prev) => { const next = new Set(prev); next.delete(id); return next })
    await loadPending()
  }

  async function reject(id: string) {
    setProcessing((prev) => new Set(prev).add(id))
    await supabase.from('memories').delete().eq('id', id).eq('project_id', projectId)
    setProcessing((prev) => { const next = new Set(prev); next.delete(id); return next })
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  function confidenceColor(c: number): string {
    if (c >= 0.75) return 'bg-green-500'
    if (c >= 0.5) return 'bg-yellow-500'
    if (c >= 0.25) return 'bg-orange-500'
    return 'bg-red-500'
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">No memories pending review.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Auto-extracted memories will appear here before going live.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {memories.map((memory) => {
        const busy = processing.has(memory.id)
        return (
          <div
            key={memory.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="flex items-start gap-3">
              <TypeBadge type={memory.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{memory.key}</p>
                <p className="mt-0.5 text-xs text-zinc-400 line-clamp-2">{memory.value}</p>

                {/* Confidence bar */}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500">confidence</span>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-700">
                    <div
                      className={`h-full rounded-full ${confidenceColor(memory.confidence)}`}
                      style={{ width: `${memory.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    {(memory.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="mt-1 flex items-center gap-2">
                  {memory.agent_name && (
                    <span className="text-[10px] text-zinc-500">{memory.agent_name}</span>
                  )}
                  <span className="text-[10px] text-zinc-600">
                    {new Date(memory.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => verify(memory.id)}
                  disabled={busy}
                  className="rounded-md bg-[#3BA3C7]/10 px-3 py-1.5 text-xs font-medium text-[#3BA3C7] transition-colors hover:bg-[#3BA3C7]/20 disabled:opacity-50"
                >
                  Verify
                </button>
                <button
                  onClick={() => reject(memory.id)}
                  disabled={busy}
                  className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
