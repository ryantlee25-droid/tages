'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from './confirm-dialog'

interface Conflict {
  id: string
  memory_a_id: string
  memory_b_id: string
  reason: string
  a_key: string
  a_value: string
  b_key: string
  b_value: string
  created_at: string
}

type Strategy = 'keep_newer' | 'keep_older' | 'merge'

export function ConflictResolver({ projectId }: { projectId: string }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState<Set<string>>(new Set())
  const [mergeModal, setMergeModal] = useState<{ conflict: Conflict; draft: string } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'keep_newer' | 'keep_older'; conflictId: string } | null>(null)

  const supabase = createClient()

  async function loadConflicts() {
    setLoading(true)
    const { data } = await supabase.rpc('list_unresolved_conflicts', {
      p_project_id: projectId,
    })
    setConflicts(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadConflicts()
  }, [projectId])

  async function resolve(conflict: Conflict, strategy: Strategy, mergedValue?: string) {
    setResolving((prev) => new Set(prev).add(conflict.id))

    // Apply resolution on the memories table directly
    if (strategy === 'keep_newer') {
      // Delete the older memory (we identify by updated_at)
      const { data: memA } = await supabase
        .from('memories')
        .select('id, updated_at')
        .eq('id', conflict.memory_a_id)
        .single()
      const { data: memB } = await supabase
        .from('memories')
        .select('id, updated_at')
        .eq('id', conflict.memory_b_id)
        .single()

      if (memA && memB) {
        const olderMemId = memA.updated_at < memB.updated_at ? memA.id : memB.id
        await supabase.from('memories').delete().eq('id', olderMemId)
      }
    } else if (strategy === 'keep_older') {
      const { data: memA } = await supabase
        .from('memories')
        .select('id, updated_at')
        .eq('id', conflict.memory_a_id)
        .single()
      const { data: memB } = await supabase
        .from('memories')
        .select('id, updated_at')
        .eq('id', conflict.memory_b_id)
        .single()

      if (memA && memB) {
        const newerMemId = memA.updated_at >= memB.updated_at ? memA.id : memB.id
        await supabase.from('memories').delete().eq('id', newerMemId)
      }
    } else if (strategy === 'merge' && mergedValue) {
      // Update memory A with merged value, delete memory B
      await supabase
        .from('memories')
        .update({ value: mergedValue, updated_at: new Date().toISOString() })
        .eq('id', conflict.memory_a_id)
      await supabase.from('memories').delete().eq('id', conflict.memory_b_id)
    }

    // Mark conflict resolved
    await supabase
      .from('memory_conflicts')
      .update({
        resolved: true,
        resolution_strategy: strategy,
        merged_value: mergedValue || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', conflict.id)

    setResolving((prev) => { const next = new Set(prev); next.delete(conflict.id); return next })
    setMergeModal(null)
    await loadConflicts()
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (conflicts.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">No unresolved conflicts.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Conflicts are detected automatically when memories have overlapping keys or file references.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-400">
        {conflicts.length} unresolved conflict{conflicts.length !== 1 ? 's' : ''}
      </p>

      <div className="space-y-4">
        {conflicts.map((conflict) => {
          const busy = resolving.has(conflict.id)
          return (
            <div key={conflict.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {conflict.reason} · {new Date(conflict.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Side-by-side diff */}
              <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-zinc-700 p-3">
                  <p className="mb-1 text-xs font-medium text-[#3BA3C7]">{conflict.a_key}</p>
                  <p className="text-xs text-zinc-300">{conflict.a_value}</p>
                </div>
                <div className="rounded-lg border border-zinc-700 p-3">
                  <p className="mb-1 text-xs font-medium text-purple-400">{conflict.b_key}</p>
                  <p className="text-xs text-zinc-300">{conflict.b_value}</p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmAction({ type: 'keep_newer', conflictId: conflict.id })}
                  disabled={busy}
                  className="rounded px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Keep Newer
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'keep_older', conflictId: conflict.id })}
                  disabled={busy}
                  className="rounded px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Keep Older
                </button>
                <button
                  onClick={() =>
                    setMergeModal({
                      conflict,
                      draft: `${conflict.a_value}\n\n${conflict.b_value}`,
                    })
                  }
                  disabled={busy}
                  className="rounded bg-[#3BA3C7]/10 px-3 py-1.5 text-xs font-medium text-[#3BA3C7] hover:bg-[#3BA3C7]/20 disabled:opacity-50"
                >
                  Merge...
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirm dialog for destructive actions */}
      {confirmAction && (() => {
        const conflict = conflicts.find((c) => c.id === confirmAction.conflictId)
        if (!conflict) return null
        const isNewer = confirmAction.type === 'keep_newer'
        return (
          <ConfirmDialog
            open={true}
            title={isNewer ? 'Keep Newer Version' : 'Keep Older Version'}
            message={
              isNewer
                ? 'This will permanently discard the older version of this memory.'
                : 'This will permanently discard the newer version of this memory.'
            }
            confirmLabel={isNewer ? 'Keep Newer' : 'Keep Older'}
            variant="danger"
            onConfirm={() => {
              setConfirmAction(null)
              resolve(conflict, confirmAction.type)
            }}
            onCancel={() => setConfirmAction(null)}
          />
        )
      })()}

      {/* Merge modal */}
      {mergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="mb-4 text-base font-semibold text-white">Merge Memories</h2>
            <p className="mb-3 text-xs text-zinc-400">
              Edit the merged content below, then confirm.
            </p>
            <textarea
              value={mergeModal.draft}
              onChange={(e) => setMergeModal({ ...mergeModal, draft: e.target.value })}
              rows={6}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setMergeModal(null)}
                className="rounded px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => resolve(mergeModal.conflict, 'merge', mergeModal.draft)}
                disabled={!mergeModal.draft.trim()}
                className="rounded bg-[#3BA3C7] px-4 py-2 text-sm font-medium text-white hover:bg-[#3BA3C7]/80 disabled:opacity-50"
              >
                Confirm Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
