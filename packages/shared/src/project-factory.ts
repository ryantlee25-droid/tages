import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProjectConfig {
  projectId: string
  slug: string
  supabaseUrl: string
  supabaseAnonKey: string
  plan?: 'free' | 'pro' | 'team'
}

/**
 * Create or find a cloud project in Supabase.
 * Returns the project config. Throws on failure.
 */
export async function createCloudProject(
  slug: string,
  userId: string,
  supabase: SupabaseClient,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<ProjectConfig> {
  // Check if project already exists for this user
  const { data: existing } = await Promise.resolve(
    supabase.from('projects').select('id, slug, name, plan').eq('slug', slug).eq('owner_id', userId)
  )

  if (existing && existing.length > 0) {
    return {
      projectId: existing[0].id as string,
      slug,
      supabaseUrl,
      supabaseAnonKey,
      plan: (existing[0].plan as 'free' | 'pro' | 'team') || 'free',
    }
  }

  // Create new project
  const { data: newProject, error } = await Promise.resolve(
    supabase
      .from('projects')
      .insert({
        name: slug.charAt(0).toUpperCase() + slug.slice(1),
        slug,
        owner_id: userId,
        default_branch: 'main',
      })
      .select('id')
      .single()
  )

  if (error || !newProject) {
    const msg = error?.message || 'Unknown error'
    if (msg.includes('violates') || msg.includes('policy') || msg.includes('row-level')) {
      throw new Error(`Free tier is limited to 2 projects. Upgrade to Pro for up to 10.`)
    }
    throw new Error(msg)
  }

  return {
    projectId: newProject.id as string,
    slug,
    supabaseUrl,
    supabaseAnonKey,
    plan: 'free',
  }
}

/**
 * Result of a successful membership-verified project lookup by ID.
 * Deliberately narrower than `ProjectConfig` — the caller (CLI `link`
 * command) supplies `supabaseUrl`/`supabaseAnonKey` itself since those are
 * not stored on the `projects` row.
 */
export interface MemberProject {
  projectId: string
  slug: string
  plan?: 'free' | 'pro' | 'team'
}

/**
 * Find a project by ID, but ONLY if the given user is actually allowed to
 * see it — i.e. they are the owner or an active `team_members` row exists
 * for (userId, projectId).
 *
 * Two independent layers enforce that, so a bug or bypass in either one
 * alone can't leak a non-member into a project:
 *
 *  1. RLS. The `projects` table's policy (supabase/migrations/0002 +
 *     `is_project_member` hardened in 0051/0053 to require `status='active'`)
 *     filters the row when `supabase` carries a real user session. Under a
 *     normal authenticated client this alone already gates the read.
 *
 *  2. An explicit owner-or-active-member assertion in JS, keyed on the
 *     caller-supplied `userId`. This is the belt to RLS's suspenders: when
 *     `createAuthenticatedClient` is running under `TAGES_SERVICE_KEY` (its
 *     documented CI/headless escape hatch) the client is service-role and
 *     RLS is bypassed entirely, so the projects row comes back for ANY id.
 *     The explicit check below re-imposes the membership boundary in that
 *     case. (Under normal auth it's redundant-but-harmless.)
 *
 * A non-member — whether the project is real-but-not-theirs or the UUID
 * doesn't exist at all — gets an indistinguishable `null`, which never
 * discloses whether a given UUID belongs to someone else's project.
 */
export async function findMemberProjectById(
  projectId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<MemberProject | null> {
  const { data, error } = await Promise.resolve(
    supabase.from('projects').select('id, slug, plan, owner_id').eq('id', projectId).single()
  )

  if (error || !data) {
    return null
  }

  // Layer 2: explicit membership assertion (defense-in-depth against an
  // RLS-bypassing service-role client). Owner always qualifies.
  if ((data.owner_id as string) !== userId) {
    const { data: membership, error: membershipError } = await Promise.resolve(
      supabase
        .from('team_members')
        .select('user_id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()
    )

    // If the membership read succeeded and returned no active row, the caller
    // is definitively NOT a member — reject. If it ERRORED (e.g. a normal
    // authenticated client whose RLS restricts reading team_members), fall
    // back to trusting layer 1: the projects row only came back because RLS
    // already vetted this caller, so a legit member isn't falsely rejected.
    if (!membershipError && !membership) {
      return null
    }
  }

  return {
    projectId: data.id as string,
    slug: data.slug as string,
    plan: (data.plan as 'free' | 'pro' | 'team') || 'free',
  }
}

/**
 * Create a local-only project config (no Supabase, no auth).
 */
export function createLocalProject(slug: string): ProjectConfig {
  return {
    projectId: `local-${slug}`,
    slug,
    supabaseUrl: '',
    supabaseAnonKey: '',
  }
}
