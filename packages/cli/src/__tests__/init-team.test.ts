import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inviteTeamMembers } from '../auth/invite.js'

// ---------------------------------------------------------------------------
// inviteTeamMembers unit tests
// ---------------------------------------------------------------------------

function makeSupabase(insertError: { message: string } | null = null) {
  const insertMock = vi.fn().mockReturnValue(
    Promise.resolve({ error: insertError }),
  )
  return {
    from: vi.fn().mockReturnValue({
      insert: insertMock,
    }),
    _insertMock: insertMock,
  }
}

describe('inviteTeamMembers', () => {
  it('invites 2 emails — produces 2 insert calls and both in invited[]', async () => {
    const supabase = makeSupabase(null)
    const result = await inviteTeamMembers(
      supabase as any,
      'project-uuid-123',
      ['alice@example.com', 'bob@example.com'],
    )

    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(supabase.from).toHaveBeenCalledWith('team_members')
    expect(supabase._insertMock).toHaveBeenCalledTimes(2)
    expect(supabase._insertMock).toHaveBeenCalledWith({
      project_id: 'project-uuid-123',
      email: 'alice@example.com',
      role: 'member',
    })
    expect(supabase._insertMock).toHaveBeenCalledWith({
      project_id: 'project-uuid-123',
      email: 'bob@example.com',
      role: 'member',
    })

    expect(result.invited).toEqual(['alice@example.com', 'bob@example.com'])
    expect(result.failed).toEqual([])
  })

  it('trims and lowercases emails before inserting', async () => {
    const supabase = makeSupabase(null)
    await inviteTeamMembers(supabase as any, 'proj-1', ['  ALICE@Example.COM  '])

    expect(supabase._insertMock).toHaveBeenCalledWith({
      project_id: 'proj-1',
      email: 'alice@example.com',
      role: 'member',
    })
  })

  it('skips blank entries in emails array', async () => {
    const supabase = makeSupabase(null)
    const result = await inviteTeamMembers(supabase as any, 'proj-1', ['', '   ', 'valid@example.com'])

    expect(supabase._insertMock).toHaveBeenCalledTimes(1)
    expect(result.invited).toEqual(['valid@example.com'])
  })

  it('puts failed emails in failed[] when insert returns an error', async () => {
    const supabase = makeSupabase({ message: 'duplicate key value' })
    const result = await inviteTeamMembers(
      supabase as any,
      'proj-1',
      ['dupe@example.com'],
    )

    expect(result.invited).toEqual([])
    expect(result.failed).toEqual([
      { email: 'dupe@example.com', error: 'duplicate key value' },
    ])
  })

  it('handles mixed success and failure across multiple emails', async () => {
    // First call succeeds, second fails
    const insertMock = vi.fn()
      .mockReturnValueOnce(Promise.resolve({ error: null }))
      .mockReturnValueOnce(Promise.resolve({ error: { message: 'not found' } }))

    const supabase = {
      from: vi.fn().mockReturnValue({ insert: insertMock }),
      _insertMock: insertMock,
    }

    const result = await inviteTeamMembers(
      supabase as any,
      'proj-1',
      ['good@example.com', 'bad@example.com'],
    )

    expect(result.invited).toEqual(['good@example.com'])
    expect(result.failed).toEqual([{ email: 'bad@example.com', error: 'not found' }])
  })

  it('returns empty invited and failed for empty emails array', async () => {
    const supabase = makeSupabase(null)
    const result = await inviteTeamMembers(supabase as any, 'proj-1', [])

    expect(supabase._insertMock).not.toHaveBeenCalled()
    expect(result.invited).toEqual([])
    expect(result.failed).toEqual([])
  })
})
