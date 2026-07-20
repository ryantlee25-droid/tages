import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findMemberProjectById } from '../project-factory'

/**
 * Builds a minimal fake Supabase client that satisfies the two calls
 * findMemberProjectById issues:
 *   rpc('is_project_member', { uid, pid })            → membership boolean
 *   from('projects').select(...).eq('id', ...).single() → project display row
 * Each result ({ data, error }) is supplied by the caller.
 */
function makeClient(results: {
  isMember: { data: unknown; error: unknown }
  projects?: { data: unknown; error: unknown }
}) {
  const rpcSpy = vi.fn((_fn: string, _args: unknown) => Promise.resolve(results.isMember))
  const fromSpy = vi.fn((_table: string) => {
    const terminal = results.projects ?? { data: null, error: null }
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.single = () => Promise.resolve(terminal)
    return builder
  })
  return { client: { rpc: rpcSpy, from: fromSpy } as unknown as SupabaseClient, rpcSpy, fromSpy }
}

describe('findMemberProjectById', () => {
  const USER = 'user-abc'
  const PROJECT_ROW = { id: 'proj-1', slug: 'team-project', plan: 'team' }

  it('returns the project when is_project_member is true (owner or active member)', async () => {
    const { client, rpcSpy } = makeClient({
      isMember: { data: true, error: null },
      projects: { data: PROJECT_ROW, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toEqual({ projectId: 'proj-1', slug: 'team-project', plan: 'team' })
    expect(rpcSpy).toHaveBeenCalledWith('is_project_member', { uid: USER, pid: 'proj-1' })
  })

  it('returns null for a NON-member even when the projects row would be visible (service-role bypass guard)', async () => {
    // is_project_member is SECURITY DEFINER, so it returns the authoritative
    // false even under an RLS-bypassing service-role client. The projects
    // read is never reached.
    const { client, fromSpy } = makeClient({
      isMember: { data: false, error: null },
      projects: { data: PROJECT_ROW, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toBeNull()
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('fails CLOSED (returns null) when the membership RPC errors', async () => {
    const { client, fromSpy } = makeClient({
      isMember: { data: null, error: { message: 'transient' } },
      projects: { data: PROJECT_ROW, error: null },
    })

    const result = await findMemberProjectById('proj-1', USER, client)

    expect(result).toBeNull()
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('returns null when membership passes but the project row is not found', async () => {
    const { client } = makeClient({
      isMember: { data: true, error: null },
      projects: { data: null, error: { message: 'no rows' } },
    })

    const result = await findMemberProjectById('nope', USER, client)

    expect(result).toBeNull()
  })

  it('defaults plan to "free" when the row has no plan', async () => {
    const { client } = makeClient({
      isMember: { data: true, error: null },
      projects: { data: { id: 'proj-2', slug: 's', plan: null }, error: null },
    })

    const result = await findMemberProjectById('proj-2', USER, client)

    expect(result).toEqual({ projectId: 'proj-2', slug: 's', plan: 'free' })
  })
})
