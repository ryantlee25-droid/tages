export interface InviteResult {
  invited: string[]
  failed: Array<{ email: string; error: string }>
}

export async function inviteTeamMembers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
  projectId: string,
  emails: string[],
): Promise<InviteResult> {
  const invited: string[] = []
  const failed: Array<{ email: string; error: string }> = []

  for (const email of emails) {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) continue

    const { error } = await Promise.resolve(
      supabase
        .from('team_members')
        .insert({
          project_id: projectId,
          email: trimmed,
          role: 'member',
        }),
    )

    if (error) {
      failed.push({ email: trimmed, error: error.message })
    } else {
      invited.push(trimmed)
    }
  }

  return { invited, failed }
}
