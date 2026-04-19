'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'
import { ConfirmDialog } from './confirm-dialog'
import { useToast } from './toast'

interface PendingMemory {
  id: string
  key: string
  value: string
  type: string
  source: string
  agent_name: string | null
  confidence: number
  created_at: string
  tags: string[]
}

function getSessionFromTags(tags: string[]): string | null {
  if (!Array.isArray(tags)) return null
  const t = tags.find(tag => tag.startsWith('session-extract:'))
  return t ? t.replace('session-extract:', '') : (tags.includes('session-extract') ? 'session-extract' : null)
}

export function PendingQueue({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<PendingMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<Set<string>>(new Set())
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // Filters
  const [minConfidence, setMinConfidence] = useState(0)
  const [groupBySession, setGroupBySession] = useState(false)

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => void
    variant?: 'danger' | 'default'
  }>({ open: false, title: '', message: '', confirmLabel: '', onConfirm: () => {} })

  const supabase = createClient()
  const { toast } = useToast()

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
      .select('id, key, value, type, source, agent_name, confidence, created_at, tags')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setMemories((data || []) as PendingMemory[])
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
    await supabase
      .from('memories')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
    setProcessing((prev) => { const next = new Set(prev); next.delete(id); return next })
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  async function bulkVerify(ids: string[], label: string) {
    setBulkProcessing(true)
    const { error } = await supabase
      .from('memories')
      .update({ status: 'live', verified_at: new Date().toISOString() })
      .in('id', ids)
    setBulkProcessing(false)
    if (error) {
      toast(`Failed to approve: ${error.message}`, 'error')
    } else {
      toast(`Approved ${label}`, 'success')
      await loadPending()
    }
  }

  async function bulkArchive(ids: string[], label: string) {
    setBulkProcessing(true)
    const { error } = await supabase
      .from('memories')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .in('id', ids)
    setBulkProcessing(false)
    if (error) {
      toast(`Failed to archive: ${error.message}`, 'error')
    } else {
      toast(`Archived ${label}`, 'success')
      await loadPending()
    }
  }

  function handleApproveAll() {
    const ids = memories.map(m => m.id)
    const n = ids.length
    setConfirmDialog({
      open: true,
      title: 'Approve all pending memories',
      message: `Approve ${n} pending ${n === 1 ? 'memory' : 'memories'}? They will become live and appear in recall.`,
      confirmLabel: `Approve ${n}`,
      variant: 'default',
      onConfirm: () => {
        setConfirmDialog(d => ({ ...d, open: false }))
        bulkVerify(ids, `${n} ${n === 1 ? 'memory' : 'memories'}`)
      },
    })
  }

  function handleApproveHighConfidence() {
    const highConf = memories.filter(m => m.confidence >= 0.8)
    const ids = highConf.map(m => m.id)
    const n = ids.length
    if (n === 0) {
      toast('No high-confidence memories to approve', 'info')
      return
    }
    setConfirmDialog({
      open: true,
      title: 'Approve high-confidence memories',
      message: `Approve ${n} high-confidence (>=80%) ${n === 1 ? 'memory' : 'memories'}?`,
      confirmLabel: `Approve ${n}`,
      variant: 'default',
      onConfirm: () => {
        setConfirmDialog(d => ({ ...d, open: false }))
        bulkVerify(ids, `${n} high-confidence ${n === 1 ? 'memory' : 'memories'}`)
      },
    })
  }

  function handleRejectAll() {
    const ids = memories.map(m => m.id)
    const n = ids.length
    setConfirmDialog({
      open: true,
      title: 'Archive all pending memories',
      message: `Archive ${n} pending ${n === 1 ? 'memory' : 'memories'}? They'll be hidden but recoverable from the archive.`,
      confirmLabel: `Archive ${n}`,
      variant: 'danger',
      onConfirm: () => {
        setConfirmDialog(d => ({ ...d, open: false }))
        bulkArchive(ids, `${n} ${n === 1 ? 'memory' : 'memories'}`)
      },
    })
  }

  function confidenceColor(c: number): string {
    if (c >= 0.8) return 'bg-green-500'
    if (c >= 0.5) return 'bg-yellow-500'
    if (c >= 0.25) return 'bg-orange-500'
    return 'bg-red-500'
  }

  function confidenceBadgeColor(c: number): string {
    if (c >= 0.8) return 'text-green-400 bg-green-400/10'
    if (c >= 0.5) return 'text-yellow-400 bg-yellow-400/10'
    return 'text-red-400 bg-red-400/10'
  }

  // Apply confidence filter
  const filteredMemories = useMemo(
    () => memories.filter(m => m.confidence >= minConfidence),
    [memories, minConfidence],
  )

  const highConfCount = useMemo(
    () => memories.filter(m => m.confidence >= 0.8).length,
    [memories],
  )

  // Group by session if requested
  const grouped = useMemo(() => {
    if (!groupBySession) return null
    const groups: Record<string, PendingMemory[]> = {}
    for (const m of filteredMemories) {
      const session = getSessionFromTags(m.tags) ?? 'No session'
      if (!groups[session]) groups[session] = []
      groups[session].push(m)
    }
    return groups
  }, [filteredMemories, groupBySession])

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

  function renderMemoryRow(memory: PendingMemory) {
    const busy = processing.has(memory.id) || bulkProcessing
    return (
      <div
        key={memory.id}
        className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
      >
        <div className="flex items-start gap-3">
          <TypeBadge type={memory.type} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-white">{memory.key}</p>
              {/* Confidence badge */}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceBadgeColor(memory.confidence)}`}>
                {(memory.confidence * 100).toFixed(0)}%
              </span>
            </div>
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
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-red-400 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Bulk action bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
        <span className="text-sm text-zinc-400">
          <span className="font-medium text-white">{memories.length}</span> pending
          {highConfCount > 0 && (
            <span className="ml-1 text-zinc-500">, <span className="text-green-400">{highConfCount}</span> high-confidence</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleApproveAll}
            disabled={bulkProcessing || memories.length === 0}
            className="rounded-md bg-[#3BA3C7] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3BA3C7]/80 disabled:opacity-50"
          >
            Approve all
          </button>
          {highConfCount > 0 && (
            <button
              onClick={handleApproveHighConfidence}
              disabled={bulkProcessing}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              Approve high-confidence ({highConfCount})
            </button>
          )}
          <button
            onClick={handleRejectAll}
            disabled={bulkProcessing || memories.length === 0}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            Reject all
          </button>
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          <label className="text-xs text-zinc-500 whitespace-nowrap">
            Min confidence: <span className="font-medium text-zinc-300">{Math.round(minConfidence * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={e => setMinConfidence(parseFloat(e.target.value))}
            className="h-1 w-32 cursor-pointer accent-[#3BA3C7]"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={groupBySession}
            onChange={e => setGroupBySession(e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-[#3BA3C7]"
          />
          Group by session
        </label>
      </div>

      {/* Memory list */}
      {filteredMemories.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-sm text-zinc-500">No memories match the current filter.</p>
        </div>
      ) : grouped ? (
        Object.entries(grouped).map(([session, mems]) => (
          <div key={session} className="space-y-2">
            <p className="px-1 text-xs font-medium text-zinc-500">{session}</p>
            {mems.map(renderMemoryRow)}
          </div>
        ))
      ) : (
        <div className="space-y-2">
          {filteredMemories.map(renderMemoryRow)}
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(d => ({ ...d, open: false }))}
      />
    </div>
  )
}
