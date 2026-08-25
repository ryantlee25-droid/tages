import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { findMemberProjectById, createCloudProject } from '../project-factory'

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

/**
 * Builds a fake client whose projects INSERT fails with `message`, so
 * createCloudProject's error-translation branches can be asserted directly.
 * The SELECT (find-existing) leg always returns no rows, so the insert runs.
 */
function makeFailingInsertClient(message: string) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.single = () => Promise.resolve({ data: null, error: { message } })
  builder.insert = () => ({
    select: () => ({ single: () => Promise.resolve({ data: null, error: { message } }) }),
  })
  // find-existing: .select().eq().eq() resolves to an empty list
  const findBuilder: Record<string, unknown> = {}
  findBuilder.select = () => findBuilder
  let eqCalls = 0
  findBuilder.eq = () => {
    eqCalls += 1
    return eqCalls >= 2
      ? (Promise.resolve({ data: [], error: null }) as unknown as Record<string, unknown>)
      : findBuilder
  }
  findBuilder.insert = builder.insert

  return { from: () => findBuilder } as unknown as SupabaseClient
}

describe('createCloudProject error translation', () => {
  it('reports the free-tier cap as 1 project, the number the RLS policy actually enforces', async () => {
    // supabase/migrations/0002_rls_policies.sql:47 — "free: max 1":
    // is_pro(uid) OR (count of owned projects) < 1. The message used to say 2,
    // which matched no limit in the system.
    const client = makeFailingInsertClient(
      'new row violates row-level security policy for table "projects"',
    )
    await expect(
      createCloudProject('phoenix', 'user-abc', client, 'https://x.supabase.co', 'anon'),
    ).rejects.toThrow(/limited to 1 project/)
  })

  it('names a slug collision as a collision instead of a billing limit', async () => {
    // A unique violation on `slug` also contains "violates", so it used to be
    // swallowed by the plan-limit branch and reported as "upgrade to Pro".
    const client = makeFailingInsertClient(
      'duplicate key value violates unique constraint "projects_slug_key"',
    )
    await expect(
      createCloudProject('phoenix', 'user-abc', client, 'https://x.supabase.co', 'anon'),
    ).rejects.toThrow(/slug 'phoenix' is already taken/)
  })

  it('points a slug collision at `link`, not at an upgrade', async () => {
    const client = makeFailingInsertClient(
      'duplicate key value violates unique constraint "projects_slug_key"',
    )
    await expect(
      createCloudProject('phoenix', 'user-abc', client, 'https://x.supabase.co', 'anon'),
    ).rejects.toThrow(/tages link --project-id/)
  })
})
