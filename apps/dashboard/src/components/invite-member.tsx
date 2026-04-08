'use client'

export function InviteMember({
  projectId: _projectId,
  onInvited: _onInvited,
}: {
  projectId: string
  onInvited: () => void
}) {
  return (
    <div className="space-y-2">
      <form className="flex gap-2">
        <input
          type="email"
          placeholder="team@example.com"
          disabled
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 opacity-50 cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          className="rounded-lg px-4 py-2 text-sm font-medium text-white opacity-50 cursor-not-allowed"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          Coming soon
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        Team invites are coming soon. For now, team members can be added directly in the Supabase dashboard.
      </p>
    </div>
  )
}
