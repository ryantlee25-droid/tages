'use client'

import { useState } from 'react'
import { useToast } from '@/components/toast'

interface Project {
  id: string
  name: string
  git_remote: string | null
  default_branch: string
}

interface ProjectSettingsFormProps {
  project: Project
  isOwner: boolean
}

export function ProjectSettingsForm({ project, isOwner }: ProjectSettingsFormProps) {
  const { toast } = useToast()
  const [name, setName] = useState(project.name)
  const [gitRemote, setGitRemote] = useState(project.git_remote ?? '')
  const [defaultBranch, setDefaultBranch] = useState(project.default_branch || 'main')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  if (!isOwner) {
    return (
      <div className="space-y-2 text-sm text-zinc-400">
        <p><span className="text-zinc-500">Name:</span> {project.name}</p>
        <p><span className="text-zinc-500">Git remote:</span> {project.git_remote || 'Not set'}</p>
        <p><span className="text-zinc-500">Default branch:</span> {project.default_branch}</p>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setMessage({ type: 'error', text: 'Project name is required.' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          git_remote: gitRemote.trim() || null,
          default_branch: defaultBranch.trim() || 'main',
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const errText = (body as { error?: string }).error ?? `Error ${res.status}`
        setMessage({ type: 'error', text: errText })
        toast(errText, 'error')
        return
      }

      setMessage({ type: 'success', text: 'Settings saved.' })
      toast('Settings saved.', 'success')
    } catch {
      const errText = 'Network error. Please try again.'
      setMessage({ type: 'error', text: errText })
      toast(errText, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="proj-name" className="mb-1 block text-sm text-zinc-400">
          Project name <span className="text-red-400">*</span>
        </label>
        <input
          id="proj-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[#3BA3C7] focus:outline-none focus:ring-1 focus:ring-[#3BA3C7]"
          placeholder="My project"
        />
      </div>

      <div>
        <label htmlFor="proj-git-remote" className="mb-1 block text-sm text-zinc-400">
          Git remote <span className="text-zinc-600">(optional)</span>
        </label>
        <input
          id="proj-git-remote"
          type="text"
          value={gitRemote}
          onChange={(e) => setGitRemote(e.target.value)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[#3BA3C7] focus:outline-none focus:ring-1 focus:ring-[#3BA3C7]"
          placeholder="https://github.com/org/repo"
        />
      </div>

      <div>
        <label htmlFor="proj-default-branch" className="mb-1 block text-sm text-zinc-400">
          Default branch
        </label>
        <input
          id="proj-default-branch"
          type="text"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-[#3BA3C7] focus:outline-none focus:ring-1 focus:ring-[#3BA3C7]"
          placeholder="main"
        />
      </div>

      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50 hover:opacity-90"
        style={{ backgroundColor: '#3BA3C7' }}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
