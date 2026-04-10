'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TypeBadge } from './type-badge'

interface Memory {
  id: string
  key: string
  value: string
  type: string
  source: string
  agent_name: string | null
  file_paths: string[]
  tags: string[]
  confidence: number
  created_at: string
  updated_at: string
}

export function MemoryRowDetail({
  memory,
  onClose,
  onUpdate,
}: {
  memory: Memory
  onClose: () => void
  onUpdate: () => void
}) {
  const [value, setValue] = useState(memory.value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const supabase = createClient()

  async function handleSave() {
    if (value === memory.value) return
    setSaving(true)
    await supabase
      .from('memories')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('id', memory.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onUpdate()
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.from('memories').delete().eq('id', memory.id)
    setDeleting(false)
    onClose()
    onUpdate()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex w-full max-w-full flex-col overflow-y-auto bg-zinc-900 p-4 shadow-xl sm:max-w-md sm:p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-medium text-white">{memory.key}</h3>
            <div className="mt-1 flex items-center gap-2">
              <TypeBadge type={memory.type} />
              <span className="text-xs text-zinc-500">{memory.source}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-6">
          <label className="text-xs font-medium text-zinc-400">Value</label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            rows={8}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
          {saving && <p className="mt-1 text-xs text-zinc-500">Saving...</p>}
          {saved && <p className="mt-1 text-xs text-green-400">Saved</p>}
        </div>

        {memory.file_paths?.length > 0 && (
          <div className="mt-4">
            <label className="text-xs font-medium text-zinc-400">Files</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {memory.file_paths.map((fp) => (
                <span key={fp} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                  {fp}
                </span>
              ))}
            </div>
          </div>
        )}

        {memory.tags?.length > 0 && (
          <div className="mt-4">
            <label className="text-xs font-medium text-zinc-400">Tags</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {memory.tags.map((tag) => (
                <span key={tag} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 text-xs text-zinc-500">
          <p>Confidence: {(memory.confidence * 100).toFixed(0)}%</p>
          <p>Created: {new Date(memory.created_at).toLocaleString()}</p>
          <p>Updated: {new Date(memory.updated_at).toLocaleString()}</p>
        </div>

        <div className="mt-6 border-t border-zinc-800 pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete this memory?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
              >
                {deleting ? 'Deleting...' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Delete memory
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
