'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface StatsData {
  total: number
  live: number
  pending: number
  byType: Record<string, number>
  confidenceBuckets: [string, number][]
  topAgents: Array<{ name: string; count: number }>
  recallHitRate: number | null
  totalSessions: number
  qualityDistribution: { excellent: number; good: number; fair: number; poor: number }
}

const TYPE_COLORS: Record<string, string> = {
  convention: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  decision: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  architecture: 'bg-green-500/10 text-green-400 border-green-500/20',
  entity: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  lesson: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  preference: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  pattern: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  execution: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
}

const TYPE_BAR_COLORS: Record<string, string> = {
  convention: 'bg-blue-500',
  decision: 'bg-purple-500',
  architecture: 'bg-green-500',
  entity: 'bg-orange-500',
  lesson: 'bg-yellow-500',
  preference: 'bg-zinc-500',
  pattern: 'bg-cyan-500',
  execution: 'bg-pink-500',
}

export function StatsDashboard({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: memories } = await supabase
        .from('memories')
        .select('type, status, confidence, agent_name')
        .eq('project_id', projectId)

      if (!memories) {
        setLoading(false)
        return
      }

      const total = memories.length
      const live = memories.filter((m) => m.status === 'live').length
      const pending = memories.filter((m) => m.status === 'pending').length

      // By type
      const byType: Record<string, number> = {}
      for (const m of memories) {
        byType[m.type] = (byType[m.type] || 0) + 1
      }

      // Confidence distribution
      const buckets: Record<string, number> = {
        '0–50%': 0,
        '50–75%': 0,
        '75–90%': 0,
        '90–100%': 0,
      }
      for (const m of memories) {
        const c = m.confidence ?? 1
        if (c < 0.5) buckets['0–50%']++
        else if (c < 0.75) buckets['50–75%']++
        else if (c < 0.9) buckets['75–90%']++
        else buckets['90–100%']++
      }
      const confidenceBuckets = Object.entries(buckets) as [string, number][]

      // Top agents
      const agentCounts: Record<string, number> = {}
      for (const m of memories) {
        if (m.agent_name) {
          agentCounts[m.agent_name] = (agentCounts[m.agent_name] || 0) + 1
        }
      }
      const topAgents = Object.entries(agentCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }))

      // Session metrics
      const { data: sessions } = await supabase
        .from('agent_sessions')
        .select('recall_hits, recall_misses')
        .eq('project_id', projectId)

      const totalSessions = sessions?.length ?? 0
      let recallHitRate: number | null = null
      if (sessions && sessions.length > 0) {
        const totalHits = sessions.reduce((s, r) => s + (r.recall_hits ?? 0), 0)
        const totalMisses = sessions.reduce((s, r) => s + (r.recall_misses ?? 0), 0)
        const totalRecalls = totalHits + totalMisses
        recallHitRate = totalRecalls > 0 ? Math.round((totalHits / totalRecalls) * 100) : null
      }

      // Quality distribution from quality_scores
      const { data: qualityRows } = await supabase
        .from('quality_scores')
        .select('score')
        .eq('project_id', projectId)

      const qualityDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 }
      if (qualityRows) {
        for (const q of qualityRows) {
          if (q.score >= 80) qualityDistribution.excellent++
          else if (q.score >= 60) qualityDistribution.good++
          else if (q.score >= 40) qualityDistribution.fair++
          else qualityDistribution.poor++
        }
      }

      setStats({ total, live, pending, byType, confidenceBuckets, topAgents, recallHitRate, totalSessions, qualityDistribution })
      setLoading(false)
    }
    load()
  }, [projectId])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-zinc-800" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-lg bg-zinc-800" />
      </div>
    )
  }

  if (!stats) return null

  const maxTypeCount = Math.max(...Object.values(stats.byType), 1)
  const maxAgentCount = Math.max(...stats.topAgents.map((a) => a.count), 1)

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Total Memories</p>
          <p className="mt-1 text-3xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Live</p>
          <p className="mt-1 text-3xl font-bold text-[#3BA3C7]">{stats.live}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Pending Review</p>
          <p className="mt-1 text-3xl font-bold text-yellow-400">{stats.pending}</p>
        </div>
      </div>

      {/* Session & Quality metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Sessions</p>
          <p className="mt-1 text-3xl font-bold text-white">{stats.totalSessions}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Recall Hit Rate</p>
          <p className="mt-1 text-3xl font-bold text-white">
            {stats.recallHitRate !== null ? `${stats.recallHitRate}%` : '--'}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-500">Quality</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm text-green-400">{stats.qualityDistribution.excellent}e</span>
            <span className="text-sm text-blue-400">{stats.qualityDistribution.good}g</span>
            <span className="text-sm text-yellow-400">{stats.qualityDistribution.fair}f</span>
            <span className="text-sm text-red-400">{stats.qualityDistribution.poor}p</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* By type */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">By Type</h3>
          <div className="space-y-2.5">
            {Object.entries(stats.byType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <span
                    className={`inline-flex w-24 shrink-0 items-center justify-center rounded border px-2 py-0.5 text-[10px] font-medium ${TYPE_COLORS[type] || TYPE_COLORS.pattern}`}
                  >
                    {type}
                  </span>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all ${TYPE_BAR_COLORS[type] || 'bg-zinc-500'}`}
                        style={{ width: `${Math.max((count / maxTypeCount) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-8 text-right text-xs text-zinc-400">{count}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Confidence distribution — 4 cards */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Confidence Distribution</h3>
          <div className="grid grid-cols-2 gap-3">
            {stats.confidenceBuckets.map(([label, count]) => (
              <div
                key={label}
                className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3"
              >
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="mt-1 text-2xl font-bold text-white">{count}</p>
                <p className="mt-0.5 text-[10px] text-zinc-600">
                  {stats.total > 0 ? Math.round((count / stats.total) * 100) : 0}% of total
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top agents */}
      {stats.topAgents.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">Top Agents</h3>
          <div className="space-y-2.5">
            {stats.topAgents.map((agent) => (
              <div key={agent.name} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-xs text-zinc-300">{agent.name}</span>
                <div className="flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-all"
                      style={{ width: `${Math.max((agent.count / maxAgentCount) * 100, 2)}%` }}
                    />
                  </div>
                </div>
                <span className="w-8 text-right text-xs text-zinc-400">{agent.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
