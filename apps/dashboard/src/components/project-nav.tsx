'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const TABS = [
  { key: 'memories', label: 'Memories', href: '' },
  { key: 'decisions', label: 'Decisions', href: '/decisions' },
  { key: 'activity', label: 'Activity', href: '/activity' },
  { key: 'pending', label: 'Pending', href: '/pending' },
  { key: 'execution', label: 'Execution', href: '/execution' },
  { key: 'conflicts', label: 'Conflicts', href: '/conflicts' },
  { key: 'graph', label: 'Graph', href: '/graph' },
  { key: 'stats', label: 'Stats', href: '/stats' },
  { key: 'settings', label: 'Settings', href: '/settings' },
]

export function ProjectNav({ slug, active, projectId }: { slug: string; active: string; projectId?: string }) {
  const [pendingCount, setPendingCount] = useState<number>(0)

  useEffect(() => {
    if (!projectId) return

    const supabase = createClient()

    async function loadCount() {
      const { count } = await supabase
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId!)
        .eq('status', 'pending')
      setPendingCount(count ?? 0)
    }

    loadCount()

    const channel = supabase
      .channel('project-nav-pending')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'memories',
          filter: `project_id=eq.${projectId}`,
        },
        () => loadCount(),
      )
      .subscribe(async (status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[tages] Realtime subscription failed, falling back to polling')
          const { count } = await supabase
            .from('memories')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', projectId!)
            .eq('status', 'pending')
          setPendingCount(count ?? 0)
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/app/projects/${slug}${tab.href}`}
          className={`relative flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.key
              ? 'border-[#3BA3C7] text-white'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {tab.label}
          {tab.key === 'pending' && pendingCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-yellow-500/20 px-1 text-[10px] font-semibold text-yellow-400">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
