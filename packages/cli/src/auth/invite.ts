export interface InviteResult {
  invited: string[]
  failed: Array<{ email: string; error: string }>
}

export async function inviteTeamMembers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
  projectId: string,
  emails: string[],
  invitedBy: string,
): Promise<InviteResult> {
  const invited: string[] = []
  const failed: Array<{ email: string; error: string }> = []

  for (const email of emails) {
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) continue

    const { error } = await Promise.resolve(
      supabase
        .from('team_members')
        .insert({
          project_id: projectId,
          email: trimmedEmail,
          role: 'member',
          status: 'pending',
          invited_by: invitedBy,
          // user_id intentionally omitted — null by default for pending invites
        }),
    )

    if (error) {
      failed.push({ email: trimmedEmail, error: error.message })
    } else {
      invited.push(trimmedEmail)
    }
  }

  return { invited, failed }
}
