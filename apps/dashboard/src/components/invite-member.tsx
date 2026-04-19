'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'

type InviteRole = 'member' | 'admin'

export function InviteMember({
  projectId,
  currentUserRole,
  onInvited,
}: {
  projectId: string
  currentUserRole: 'owner' | 'admin' | 'member'
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [loading, setLoading] = useState(false)
  const [seatInfo, setSeatInfo] = useState<{ used: number; limit: number } | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  const canInviteAdmin = currentUserRole === 'owner'

  useEffect(() => {
    async function checkSeats() {
      try {
        const [limitResult, countResult] = await Promise.all([
          Promise.resolve(supabase.rpc('seat_limit_for_project', { pid: projectId })),
          supabase
            .from('team_members')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('status', 'active'),
        ])
        if (limitResult.data && countResult.count !== null) {
          setSeatInfo({ used: countResult.count, limit: limitResult.data })
        }
      } catch {
        // Non-critical — form still works without seat info
      }
    }
    checkSeats()
  }, [projectId])

  const atSeatLimit = seatInfo ? seatInfo.used >= seatInfo.limit : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast('Please enter a valid email address.', 'error')
      return
    }

    if (atSeatLimit) {
      toast('Seat limit reached. Upgrade your plan to invite more members.', 'error')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, role }),
      })

      if (res.ok) {
        toast(`Invite sent to ${trimmed}.`, 'success')
        setEmail('')
        setRole('member')
        onInvited()
        return
      }

      let message = ''
      try {
        const body = await res.json()
        message = typeof body?.error === 'string' ? body.error : ''
      } catch {
        // no body
      }

      if (res.status === 409) {
        toast('Already invited; pending.', 'error')
      } else if (res.status === 422) {
        toast('Seat limit reached — upgrade plan or remove a member to invite.', 'error')
      } else if (res.status === 403) {
        toast("You don't have permission to assign that role.", 'error')
      } else {
        toast(message || 'Failed to send invite.', 'error')
      }
    } catch (err: any) {
      console.error('[invite-member] invite failed', err)
      toast(err?.message || 'Failed to send invite.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      {atSeatLimit && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          Seat limit reached ({seatInfo!.used} / {seatInfo!.limit}).{' '}
          <a href="/app/upgrade" className="underline hover:text-yellow-300">
            Upgrade plan
          </a>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          placeholder="team@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#3BA3C7] focus:outline-none focus:ring-1 focus:ring-[#3BA3C7]"
        />
        {canInviteAdmin && (
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            disabled={loading}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-[#3BA3C7] focus:outline-none focus:ring-1 focus:ring-[#3BA3C7]"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        )}
        <button
          type="submit"
          disabled={loading || !email.trim() || atSeatLimit}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          {loading ? 'Inviting...' : 'Invite'}
        </button>
      </form>
    </div>
  )
}
