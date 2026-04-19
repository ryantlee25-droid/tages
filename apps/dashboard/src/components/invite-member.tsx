'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'

export function InviteMember({
  projectId,
  onInvited,
}: {
  projectId: string
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [seatInfo, setSeatInfo] = useState<{ used: number; limit: number } | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await Promise.resolve(
        supabase.from('team_members').insert({
          project_id: projectId,
          email: trimmed,
          role: 'member',
          status: 'pending',
          invited_by: user.id,
        })
      )
      if (error) throw error
      toast(`Invite sent to ${trimmed}.`, 'success')
      setEmail('')
      onInvited()
    } catch (err: any) {
      console.error('[invite-member] invite failed', err)
      const msg: string = err?.message ?? ''
      if (msg.includes('Seat limit reached')) {
        toast('Your team is at its seat limit. Remove a member or add more seats in billing to invite.', 'error')
      } else {
        toast(msg || 'Failed to send invite.', 'error')
      }
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
