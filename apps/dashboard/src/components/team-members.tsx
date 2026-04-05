'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { InviteMember } from './invite-member'

interface TeamMember {
  id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
  email?: string
}

export function TeamMembers({
  projectId,
  isOwner,
}: {
  projectId: string
  isOwner: boolean
}) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadMembers()
  }, [projectId])

  async function loadMembers() {
    const { data } = await supabase
      .from('team_members')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
    setMembers(data || [])
    setLoading(false)
  }

  async function removeMember(memberId: string) {
    await supabase.from('team_members').delete().eq('id', memberId)
    loadMembers()
  }

  const ROLE_COLORS: Record<string, string> = {
    owner: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    admin: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    member: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  }

  return (
    <div>
      <h3 className="text-lg font-medium text-white">Team</h3>
      <p className="mt-1 text-sm text-zinc-400">Manage who can access this project.</p>

      {isOwner && (
        <div className="mt-4">
          <InviteMember projectId={projectId} onInvited={loadMembers} />
        </div>
      )}

      <div className="mt-6 space-y-2">
        {loading ? (
          [...Array(2)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-800" />
          ))
        ) : members.length === 0 ? (
          <p className="text-sm text-zinc-500">No team members yet.</p>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-300">{m.user_id.slice(0, 8)}...</span>
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role] || ROLE_COLORS.member}`}>
                  {m.role}
                </span>
              </div>
              {isOwner && m.role !== 'owner' && (
                <button
                  onClick={() => removeMember(m.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
