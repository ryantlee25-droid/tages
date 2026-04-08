'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { InviteMember } from './invite-member'

// TODO: replace window.confirm with ConfirmDialog once confirm-dialog.tsx is available (H2)

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
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    loadMembers()
  }, [projectId])

  async function loadMembers() {
    try {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setMembers(data || [])
    } catch (err) {
      console.error('[team-members] loadMembers failed', err)
      toast('Failed to load team members.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function removeMember(memberId: string) {
    try {
      const { error } = await supabase.from('team_members').delete().eq('id', memberId)
      if (error) throw error
      await loadMembers()
    } catch (err) {
      console.error('[team-members] removeMember failed', err)
      toast('Failed to remove team member.', 'error')
    }
  }

  function handleRemoveClick(memberId: string) {
    setConfirmRemoveId(memberId)
  }

  async function handleConfirmRemove() {
    if (!confirmRemoveId) return
    const id = confirmRemoveId
    setConfirmRemoveId(null)
    await removeMember(id)
  }

  function handleCancelRemove() {
    setConfirmRemoveId(null)
  }

  function displayIdentity(member: TeamMember): React.ReactNode {
    if (member.user_id.includes('@')) {
      return <span className="text-sm text-zinc-300">{member.user_id}</span>
    }
    return <span className="text-sm text-zinc-500 italic">Member (pending)</span>
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
                {displayIdentity(m)}
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[m.role] || ROLE_COLORS.member}`}>
                  {m.role}
                </span>
              </div>
              {isOwner && m.role !== 'owner' && (
                <button
                  onClick={() => handleRemoveClick(m.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Inline confirm dialog — replace with ConfirmDialog from H2 once available */}
      {confirmRemoveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
            <h4 className="text-base font-medium text-white">Remove team member?</h4>
            <p className="mt-2 text-sm text-zinc-400">
              Remove this team member? They will lose access to this project.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={handleCancelRemove}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemove}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
