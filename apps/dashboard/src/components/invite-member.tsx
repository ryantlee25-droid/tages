'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function InviteMember({
  projectId,
  onInvited,
}: {
  projectId: string
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    setLoading(true)
    setMessage('')

    const supabase = createClient()

    // Look up user by email via admin or invite
    // For now, we create a team_members entry with a placeholder user_id
    // The invited user will be linked when they sign in
    const { error } = await supabase.from('team_members').insert({
      project_id: projectId,
      user_id: email, // placeholder — real impl would resolve via invite
      role: 'member',
    })

    if (error) {
      setMessage(error.message)
    } else {
      setMessage(`Invited ${email}`)
      setEmail('')
      onInvited()
    }

    setLoading(false)
  }

  return (
    <form onSubmit={handleInvite} className="flex gap-2">
      <input
        type="email"
        placeholder="team@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        style={{ backgroundColor: '#3BA3C7' }}
      >
        {loading ? 'Inviting...' : 'Invite'}
      </button>
      {message && <span className="self-center text-xs text-zinc-400">{message}</span>}
    </form>
  )
}
