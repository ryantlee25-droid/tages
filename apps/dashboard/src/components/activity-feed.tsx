'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'

interface ActivityItem {
  id: string
  key: string
  type: string
  source: string
  agent_name: string | null
  created_at: string
}

function relativeTime(date: string): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then

  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function ActivityFeed({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('memories')
        .select('id, key, type, source, agent_name, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50)
      setItems(data || [])
      setLoading(false)
    }
    load()

    // Live updates
    const channel = supabase
      .channel('activity-feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'memories',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          setItems((prev) => [payload.new as ActivityItem, ...prev].slice(0, 50))
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">No activity yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-800/30">
          <TypeBadge type={item.type} />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">{item.key}</span>
          {item.agent_name && (
            <span className="text-xs text-zinc-500">{item.agent_name}</span>
          )}
          <span className="shrink-0 text-xs text-zinc-600">{relativeTime(item.created_at)}</span>
        </div>
      ))}
    </div>
  )
}
