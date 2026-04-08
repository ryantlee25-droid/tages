'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'
import { MemoryRowDetail } from './memory-row-detail'
import { useToast } from './toast'
import { ConfirmDialog } from './confirm-dialog'

interface Memory {
  id: string
  key: string
  value: string
  type: string
  source: string
  status: string
  agent_name: string | null
  file_paths: string[]
  tags: string[]
  confidence: number
  created_at: string
  updated_at: string
}

const MEMORY_TYPES = ['all', 'convention', 'decision', 'architecture', 'entity', 'lesson', 'preference', 'pattern', 'execution']
type StatusFilter = 'live' | 'pending' | 'all'

const PAGE_SIZE = 50

export function MemoryTable({ projectId }: { projectId: string }) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [filter, setFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('live')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<Memory | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifying, setVerifying] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null)

  const { toast } = useToast()
  const supabase = createClient()

  // Debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
      setMemories([])
    }, 300)
    return () => clearTimeout(timeout)
  }, [search])

  // Reset page when filters change
  useEffect(() => {
    setPage(0)
    setMemories([])
  }, [filter, statusFilter])

  // Realtime subscription — only depends on projectId
  useEffect(() => {
    const channel = supabase
      .channel('memories-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'memories',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          setPage(0)
          setMemories([])
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Data loading — depends on all query parameters
  useEffect(() => {
    loadMemories(0, false)
  }, [projectId, filter, statusFilter, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMemories(targetPage = 0, append = false) {
    setLoading(true)
    try {
      if (debouncedSearch.trim()) {
        const { data, error } = await supabase.rpc('recall_memories', {
          p_project_id: projectId,
          p_query: debouncedSearch,
          p_type: filter === 'all' ? null : filter,
          p_limit: PAGE_SIZE,
        })
        if (error) throw error
        const filtered = statusFilter === 'all'
          ? (data || [])
          : (data || []).filter((m: Memory) => m.status === statusFilter)
        setMemories(filtered)
        setHasMore(false) // RPC doesn't support pagination
      } else {
        const from = targetPage * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        let query = supabase
          .from('memories')
          .select('*')
          .eq('project_id', projectId)
          .order('updated_at', { ascending: false })
          .range(from, to)

        if (filter !== 'all') {
          query = query.eq('type', filter)
        }
        if (statusFilter !== 'all') {
          query = query.eq('status', statusFilter)
        }

        const { data, error } = await query
        if (error) throw error
        const rows = data || []
        setHasMore(rows.length === PAGE_SIZE)
        if (append) {
          setMemories((prev) => [...prev, ...rows])
        } else {
          setMemories(rows)
        }
      }
    } catch (err) {
      toast(`Failed to load memories: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  function loadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    loadMemories(nextPage, true)
  }

  async function verifyMemory(id: string) {
    setVerifying((prev) => new Set(prev).add(id))
    try {
      const { error } = await supabase
        .from('memories')
        .update({ status: 'live', verified_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      await loadMemories(0, false)
      setPage(0)
    } catch (err) {
      toast(`Failed to verify memory: ${(err as Error).message}`, 'error')
    } finally {
      setVerifying((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function rejectMemory(id: string) {
    setVerifying((prev) => new Set(prev).add(id))
    try {
      const { error } = await supabase
        .from('memories')
        .update({ status: 'rejected' })
        .eq('id', id)
      if (error) throw error
      setMemories((prev) => prev.filter((m) => m.id !== id))
      toast('Memory marked as rejected', 'success')
    } catch (err) {
      toast(`Failed to reject memory: ${(err as Error).message}`, 'error')
    } finally {
      setVerifying((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  const totalShowing = memories.length

  return (
    <div>
      {/* Search + Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Search memories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      {/* Type tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto">
        {MEMORY_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === type
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {type === 'all' ? 'All' : type}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="mb-4 flex gap-1">
        {(['live', 'pending', 'all'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s
                ? s === 'pending'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : s === 'live'
                  ? 'bg-[#3BA3C7]/10 text-[#3BA3C7]'
                  : 'bg-zinc-700 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {s === 'live' ? 'Live' : s === 'pending' ? 'Pending' : 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading && memories.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-800" />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-12 text-center">
          <p className="text-sm text-zinc-400">No memories yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Use <code className="rounded bg-zinc-800 px-1">tages remember</code> or the MCP server to store memories.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {memories.map((memory) => {
              const isPending = memory.status === 'pending'
              const busy = verifying.has(memory.id)
              return (
                <div
                  key={memory.id}
                  className="flex w-full items-start gap-3 rounded-lg p-3 transition-colors hover:bg-zinc-800/50"
                >
                  <button
                    onClick={() => setSelected(memory)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    <TypeBadge type={memory.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white">{memory.key}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-400">
                        {memory.value.length > 80
                          ? memory.value.slice(0, 80) + '...'
                          : memory.value}
                      </p>
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {isPending ? (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => verifyMemory(memory.id)}
                          disabled={busy}
                          className="rounded px-2 py-1 text-[10px] font-medium text-[#3BA3C7] hover:bg-[#3BA3C7]/10 disabled:opacity-50"
                        >
                          Verify
                        </button>
                        <button
                          onClick={() => setConfirmRejectId(memory.id)}
                          disabled={busy}
                          className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-700 hover:text-white disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500">{memory.source}</span>
                    )}
                    <span className="text-xs text-zinc-600">
                      {new Date(memory.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination footer */}
          <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
            <span>Showing {totalShowing} result{totalShowing !== 1 ? 's' : ''}</span>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loading}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        </>
      )}

      {/* Detail sheet */}
      {selected && (
        <MemoryRowDetail
          memory={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => { setPage(0); loadMemories(0, false) }}
        />
      )}

      {/* Reject confirmation dialog */}
      <ConfirmDialog
        open={confirmRejectId !== null}
        title="Reject memory?"
        message="Are you sure? This will mark the memory as rejected."
        confirmLabel="Reject"
        variant="danger"
        onConfirm={() => {
          if (confirmRejectId) {
            rejectMemory(confirmRejectId)
            setConfirmRejectId(null)
          }
        }}
        onCancel={() => setConfirmRejectId(null)}
      />
    </div>
  )
}
