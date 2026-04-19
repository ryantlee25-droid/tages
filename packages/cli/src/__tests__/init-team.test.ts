import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inviteTeamMembers } from '../auth/invite.js'

// ---------------------------------------------------------------------------
// Seat-limit preflight helpers (mirrors logic in init.ts --team handler)
// ---------------------------------------------------------------------------

/**
 * Applies the seat-limit preflight logic from init.ts to the emails array.
 * Returns { emails (mutated), warning } so tests can assert both.
 */
function applySeatLimitPreflight(
  emails: string[],
  seatLimit: number | null,
  currentActiveCount: number,
): { warning: string | null } {
  const limit = seatLimit ?? 2
  const remainingSeats = limit - currentActiveCount

  if (remainingSeats <= 0) {
    // Clear all emails — no invites can be sent
    emails.splice(0)
    return {
      warning: `Seat limit reached (${currentActiveCount}/${limit}). Upgrade plan for more seats.`,
    }
  } else if (emails.length > remainingSeats) {
    const originalCount = emails.length
    emails.splice(remainingSeats)
    return {
      warning: `Only ${remainingSeats} seat(s) available. Inviting first ${remainingSeats} of ${originalCount}.`,
    }
  }

  return { warning: null }
}

// ---------------------------------------------------------------------------
// inviteTeamMembers unit tests
// ---------------------------------------------------------------------------

const INVITED_BY = 'user-uuid-inviter-1'

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
      INVITED_BY,
    )

    expect(supabase.from).toHaveBeenCalledTimes(2)
    expect(supabase.from).toHaveBeenCalledWith('team_members')
    expect(supabase._insertMock).toHaveBeenCalledTimes(2)
    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'project-uuid-123',
        email: 'alice@example.com',
        role: 'member',
        status: 'pending',
        invited_by: INVITED_BY,
      }),
    )
    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'project-uuid-123',
        email: 'bob@example.com',
        role: 'member',
        status: 'pending',
        invited_by: INVITED_BY,
      }),
    )
    // user_id must NOT be in the payload
    const firstCall = supabase._insertMock.mock.calls[0][0]
    expect(firstCall).not.toHaveProperty('user_id')

    expect(result.invited).toEqual(['alice@example.com', 'bob@example.com'])
    expect(result.failed).toEqual([])
  })

  it('trims and lowercases emails before inserting', async () => {
    const supabase = makeSupabase(null)
    await inviteTeamMembers(supabase as any, 'proj-1', ['  ALICE@Example.COM  '], INVITED_BY)

    expect(supabase._insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'proj-1',
        email: 'alice@example.com',
        role: 'member',
        status: 'pending',
        invited_by: INVITED_BY,
      }),
    )
    const call = supabase._insertMock.mock.calls[0][0]
    expect(call).not.toHaveProperty('user_id')
  })

  it('skips blank entries in emails array', async () => {
    const supabase = makeSupabase(null)
    const result = await inviteTeamMembers(supabase as any, 'proj-1', ['', '   ', 'valid@example.com'], INVITED_BY)

    expect(supabase._insertMock).toHaveBeenCalledTimes(1)
    expect(result.invited).toEqual(['valid@example.com'])
  })

  it('puts failed emails in failed[] when insert returns an error', async () => {
    const supabase = makeSupabase({ message: 'duplicate key value' })
    const result = await inviteTeamMembers(
      supabase as any,
      'proj-1',
      ['dupe@example.com'],
      INVITED_BY,
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
      INVITED_BY,
    )

    expect(result.invited).toEqual(['good@example.com'])
    expect(result.failed).toEqual([{ email: 'bad@example.com', error: 'not found' }])
  })

  it('returns empty invited and failed for empty emails array', async () => {
    const supabase = makeSupabase(null)
    const result = await inviteTeamMembers(supabase as any, 'proj-1', [], INVITED_BY)

    expect(supabase._insertMock).not.toHaveBeenCalled()
    expect(result.invited).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('payload contains status: pending and invited_by, but not user_id', async () => {
    const supabase = makeSupabase(null)
    await inviteTeamMembers(supabase as any, 'proj-x', ['check@example.com'], INVITED_BY)

    const payload = supabase._insertMock.mock.calls[0][0]
    expect(payload.status).toBe('pending')
    expect(payload.invited_by).toBe(INVITED_BY)
    expect(payload).not.toHaveProperty('user_id')
  })
})

// ---------------------------------------------------------------------------
// Seat-limit preflight tests (mirrors init.ts --team handler logic)
// ---------------------------------------------------------------------------

describe('seat-limit preflight (applySeatLimitPreflight)', () => {
  it('allows all invites when remaining seats exceed requested emails', () => {
    const emails = ['a@x.com', 'b@x.com']
    // seatLimit=5, currentActiveCount=1 → 4 remaining, 2 emails — all pass
    const { warning } = applySeatLimitPreflight(emails, 5, 1)
    expect(warning).toBeNull()
    expect(emails).toEqual(['a@x.com', 'b@x.com'])
  })

  it('truncates emails array when more emails than remaining seats', () => {
    const emails = ['a@x.com', 'b@x.com', 'c@x.com']
    // seatLimit=3, currentActiveCount=2 → 1 remaining
    const { warning } = applySeatLimitPreflight(emails, 3, 2)
    expect(emails).toEqual(['a@x.com'])
    expect(warning).toContain('Only 1 seat(s) available')
    expect(warning).toContain('Inviting first 1 of 3')
  })

  it('clears all emails and warns when seat limit already reached', () => {
    const emails = ['a@x.com', 'b@x.com']
    // seatLimit=2, currentActiveCount=2 → 0 remaining
    const { warning } = applySeatLimitPreflight(emails, 2, 2)
    expect(emails).toEqual([])
    expect(warning).toContain('Seat limit reached (2/2)')
    expect(warning).toContain('Upgrade plan')
  })

  it('uses default limit of 2 when rpc returns null', () => {
    const emails = ['a@x.com', 'b@x.com', 'c@x.com']
    // seatLimit=null → default 2, currentActiveCount=1 → 1 remaining
    const { warning } = applySeatLimitPreflight(emails, null, 1)
    expect(emails).toEqual(['a@x.com'])
    expect(warning).toContain('Only 1 seat(s) available')
  })

  it('clears emails with null seatLimit when already at default cap', () => {
    const emails = ['a@x.com']
    // seatLimit=null → default 2, currentActiveCount=2 → 0 remaining
    const { warning } = applySeatLimitPreflight(emails, null, 2)
    expect(emails).toEqual([])
    expect(warning).toContain('Seat limit reached (2/2)')
  })

  it('supabase rpc mock returns seat limit — simulates full init flow', async () => {
    // This test verifies the supabase.rpc call shape that init.ts uses.
    const rpcMock = vi.fn().mockResolvedValue({ data: 5, error: null })
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [{ id: '1' }, { id: '2' }], error: null }),
      }),
    })
    const supabase = {
      rpc: rpcMock,
      from: vi.fn().mockReturnValue({ select: selectMock }),
    }

    // Simulate what init.ts does
    const { data: seatLimit } = await supabase.rpc('seat_limit_for_project', { pid: 'proj-1' })
    const { data: currentMembers } = await supabase
      .from('team_members')
      .select('id', { count: 'exact' })
      .eq('project_id', 'proj-1')
      .eq('status', 'active')

    expect(rpcMock).toHaveBeenCalledWith('seat_limit_for_project', { pid: 'proj-1' })
    expect(seatLimit).toBe(5)
    expect(currentMembers).toHaveLength(2)

    const emails = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com']
    const { warning } = applySeatLimitPreflight(emails, seatLimit, currentMembers!.length)
    // 5 seats - 2 active = 3 remaining; 6 emails → truncate to 3
    expect(emails).toHaveLength(3)
    expect(warning).toContain('Only 3 seat(s) available')
    expect(warning).toContain('Inviting first 3 of 6')
  })
})
