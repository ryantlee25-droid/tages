'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'

interface Memory {
  id: string
  key: string
  value: string
  type: string
  similarity?: number
}

export function CommandPalette({
  projectId,
  onSelect,
}: {
  projectId: string
  onSelect: (memory: Memory) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)

  const supabase = createClient()

  // Cmd+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Debounced search
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    const { data } = await supabase.rpc('recall_memories', {
      p_project_id: projectId,
      p_query: q,
      p_type: null,
      p_limit: 10,
    })
    setResults(data || [])
    setLoading(false)
  }, [projectId, supabase])

  useEffect(() => {
    const timeout = setTimeout(() => search(query), 300)
    return () => clearTimeout(timeout)
  }, [query, search])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center border-b border-zinc-800 px-4">
          <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            autoFocus
            type="text"
            placeholder="Search memories..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent px-3 py-4 text-sm text-white placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && (
            <p className="px-3 py-4 text-center text-xs text-zinc-500">Searching...</p>
          )}
          {!loading && query && results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-zinc-500">No results found.</p>
          )}
          {results.map((mem) => (
            <button
              key={mem.id}
              onClick={() => { onSelect(mem); setOpen(false) }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800"
            >
              <TypeBadge type={mem.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{mem.key}</p>
                <p className="truncate text-xs text-zinc-500">{mem.value}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
