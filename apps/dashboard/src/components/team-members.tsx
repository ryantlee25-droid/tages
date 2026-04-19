'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { InviteMember } from './invite-member'
import { ConfirmDialog } from './confirm-dialog'

interface TeamMember {
  id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  created_at: string
  email: string | null
  status: 'pending' | 'active' | 'revoked'
}

export function TeamMembers({
  projectId,
  currentUserRole,
}: {
  projectId: string
  currentUserRole: 'owner' | 'admin' | 'member'
}) {
  const canManage = currentUserRole === 'owner' || currentUserRole === 'admin'
  const canChangeRoles = currentUserRole === 'owner'

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmRoleChange, setConfirmRoleChange] = useState<{ id: string; role: string } | null>(null)
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
        .neq('status', 'revoked')
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
      const { error } = await supabase
        .from('team_members')
        .update({ status: 'revoked' })
        .eq('id', memberId)
        .eq('project_id', projectId)
      if (error) throw error
      await loadMembers()
      toast('Team member removed.', 'success')
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

  async function handleConfirmRoleChange() {
    if (!confirmRoleChange) return
    const { id, role } = confirmRoleChange
    setConfirmRoleChange(null)
    try {
      const { error } = await supabase
        .from('team_members')
        .update({ role })
        .eq('id', id)
        .eq('project_id', projectId)
      if (error) throw error
      await loadMembers()
      toast(`Role changed to ${role}.`, 'success')
    } catch (err) {
      console.error('[team-members] changeRole failed', err)
      toast('Failed to change role.', 'error')
    }
  }

  function displayIdentity(member: TeamMember): React.ReactNode {
    const label = member.email || member.user_id
    return <span className="text-sm text-zinc-300">{label}</span>
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

      {canManage && (
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
                {m.status === 'pending' && (
                  <span className="rounded-md border border-yellow-500/20 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
                    pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {canChangeRoles && m.role !== 'owner' && (
                  <select
                    value={m.role}
                    onChange={(e) => setConfirmRoleChange({ id: m.id, role: e.target.value })}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                  >
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                )}
                {canManage && m.role !== 'owner' && (
                  <button
                    onClick={() => handleRemoveClick(m.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={confirmRemoveId !== null}
        title="Remove team member?"
        message="They will lose access to this project."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={handleConfirmRemove}
        onCancel={handleCancelRemove}
      />
      <ConfirmDialog
        open={confirmRoleChange !== null}
        title="Change role?"
        message={`Change this member's role to ${confirmRoleChange?.role}?`}
        confirmLabel="Change role"
        variant="default"
        onConfirm={handleConfirmRoleChange}
        onCancel={() => setConfirmRoleChange(null)}
      />
    </div>
  )
}
