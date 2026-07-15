import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findMemberProjectById } from '../project-factory'

/**
 * Builds a minimal fake Supabase client that satisfies the two query chains
 * findMemberProjectById issues:
 *   from('projects').select(...).eq('id', ...).single()
 *   from('team_members').select(...).eq(...).eq(...).eq(...).maybeSingle()
 * Each table's terminal result ({ data, error }) is supplied by the caller.
 */
function makeClient(results: {
  projects: { data: unknown; error: unknown }
  team_members?: { data: unknown; error: unknown }
}) {
  const fromSpy = vi.fn((table: string) => {
    const terminal =
      table === 'projects' ? results.projects : results.team_members ?? { data: null, error: null }
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.single = () => Promise.resolve(terminal)
    builder.maybeSingle = () => Promise.resolve(terminal)
    return builder
  })
  return { client: { from: fromSpy } as unknown as SupabaseClient, fromSpy }
}

describe('findMemberProjectById', () => {
  const USER = 'user-abc'
  const PROJECT_ROW = { id: 'proj-1', slug: 'team-project', plan: 'team' }

  it('returns the project for the OWNER without querying team_members', async () => {
    const { client, fromSpy } = makeClient({
      projects: { data: { ...PROJECT_ROW, owner_id: USER }, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toEqual({ projectId: 'proj-1', slug: 'team-project', plan: 'team' })
    // Owner short-circuits — team_members is never consulted.
    expect(fromSpy).toHaveBeenCalledTimes(1)
    expect(fromSpy).toHaveBeenCalledWith('projects')
  })

  it('returns the project for an ACTIVE non-owner member', async () => {
    const { client, fromSpy } = makeClient({
      projects: { data: { ...PROJECT_ROW, owner_id: 'someone-else' }, error: null },
      team_members: { data: { user_id: USER }, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toEqual({ projectId: 'proj-1', slug: 'team-project', plan: 'team' })
    expect(fromSpy).toHaveBeenCalledWith('team_members')
  })

  it('returns null for a NON-member even when the projects row is visible (service-role bypass guard)', async () => {
    // Simulates an RLS-bypassing service-role client: the projects row comes
    // back for a non-member, so the explicit team_members check is what must
    // reject them.
    const { client } = makeClient({
      projects: { data: { ...PROJECT_ROW, owner_id: 'someone-else' }, error: null },
      team_members: { data: null, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toBeNull()
  })

  it('falls back to the RLS-vetted projects row when the team_members read errors (legit member, restrictive RLS)', async () => {
    // Under a normal authenticated client, RLS may deny reading team_members
    // even for a legit member; the projects row only came back because RLS
    // already vetted the caller, so we must NOT falsely reject them.
    const { client } = makeClient({
      projects: { data: { ...PROJECT_ROW, owner_id: 'someone-else' }, error: null },
      team_members: { data: null, error: { message: 'permission denied' } },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toEqual({ projectId: 'proj-1', slug: 'team-project', plan: 'team' })
  })

  it('returns null when the project does not exist / is not visible', async () => {
    const { client } = makeClient({
      projects: { data: null, error: { message: 'no rows' } },
    })

    const result = await findMemberProjectById('nope', USER, client)

    expect(result).toBeNull()
  })

  it('defaults plan to "free" when the row has no plan', async () => {
    const { client } = makeClient({
      projects: { data: { id: 'proj-2', slug: 's', plan: null, owner_id: USER }, error: null },
    })

    const result = await findMemberProjectById('proj-2', USER, client)

    expect(result).toEqual({ projectId: 'proj-2', slug: 's', plan: 'free' })
  })
})
