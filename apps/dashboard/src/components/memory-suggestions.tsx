'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Suggestion {
  topic: string
  description: string
  confidence: number
}

interface NewMemoryForm {
  key: string
  value: string
  type: string
}

const MEMORY_TYPES = ['convention', 'decision', 'architecture', 'entity', 'lesson', 'preference', 'pattern', 'execution']

export function MemorySuggestions({ projectId }: { projectId: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [form, setForm] = useState<NewMemoryForm & { topic: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    loadSuggestions()
  }, [projectId])

  async function loadSuggestions() {
    setLoading(true)
    // Suggestions based on memory type gaps
    const { data: memories } = await supabase
      .from('memories')
      .select('type')
      .eq('project_id', projectId)
      .eq('status', 'live')

    const typeCounts: Record<string, number> = {}
    for (const m of (memories || [])) {
      typeCounts[m.type] = (typeCounts[m.type] || 0) + 1
    }

    const derived: Suggestion[] = []
    const allTypes = ['convention', 'decision', 'architecture', 'entity', 'lesson', 'pattern', 'execution']
    for (const type of allTypes) {
      const count = typeCounts[type] || 0
      if (count === 0) {
        derived.push({
          topic: type,
          description: `No ${type} memories stored yet. ${getTypeHint(type)}`,
          confidence: 0.9,
        })
      } else if (count < 3) {
        derived.push({
          topic: type,
          description: `Only ${count} ${type} memor${count === 1 ? 'y' : 'ies'}. Consider adding more.`,
          confidence: 0.5,
        })
      }
    }

    setSuggestions(derived.slice(0, 8))
    setLoading(false)
  }

  async function acceptSuggestion() {
    if (!form) return
    setSaving(true)

    const { randomUUID } = await import('crypto').catch(() => ({ randomUUID: () => `${Date.now()}-${Math.random()}` }))
    const now = new Date().toISOString()

    await supabase.from('memories').insert({
      id: typeof randomUUID === 'function' ? randomUUID() : `${Date.now()}`,
      project_id: projectId,
      key: form.key,
      value: form.value,
      type: form.type,
      source: 'manual',
      status: 'live',
      confidence: 1.0,
      file_paths: [],
      tags: [],
      created_at: now,
      updated_at: now,
    })

    setSaving(false)
    setForm(null)
    setAccepting(null)
    await loadSuggestions()
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-800" />
        ))}
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-sm text-zinc-400">Great coverage! No suggestions at this time.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-400">
        {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} to improve memory coverage
      </p>

      <div className="space-y-3">
        {suggestions.map((s) => (
          <div
            key={s.topic}
            className="flex items-start justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white capitalize">{s.topic}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{s.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-zinc-500">
                {(s.confidence * 100).toFixed(0)}%
              </span>
              <button
                onClick={() => {
                  setAccepting(s.topic)
                  setForm({ topic: s.topic, key: '', value: '', type: s.topic })
                }}
                className="rounded bg-[#3BA3C7]/10 px-3 py-1 text-xs font-medium text-[#3BA3C7] hover:bg-[#3BA3C7]/20"
              >
                Accept & Store
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Accept modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="mb-4 text-base font-semibold text-white">
              Store {form.topic} memory
            </h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Key</label>
                <input
                  type="text"
                  placeholder="e.g. auth-token-convention"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Value</label>
                <textarea
                  placeholder="Describe the memory..."
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
                >
                  {MEMORY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setForm(null); setAccepting(null) }}
                className="rounded px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={acceptSuggestion}
                disabled={saving || !form.key.trim() || !form.value.trim()}
                className="rounded bg-[#3BA3C7] px-4 py-2 text-sm font-medium text-white hover:bg-[#3BA3C7]/80 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Store Memory'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getTypeHint(type: string): string {
  const hints: Record<string, string> = {
    convention: 'Store coding style rules and naming conventions.',
    decision: 'Record why architectural decisions were made.',
    architecture: 'Document module boundaries and system design.',
    entity: 'Describe key domain objects and their relationships.',
    lesson: 'Capture what went wrong and lessons learned.',
    pattern: 'Save reusable patterns and templates that work well.',
    execution: 'Document step-by-step workflows and runbooks.',
  }
  return hints[type] || ''
}
