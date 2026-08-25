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

    // A unique violation on `slug` also contains the word "violates", and used
    // to be reported as a plan limit — which sent people to the billing page
    // over a name collision. Check it first and name the real cause.
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      throw new Error(
        `The slug '${slug}' is already taken. Project slugs are globally unique across all owners. ` +
          `To JOIN an existing project use \`tages link --project-id <uuid>\`; ` +
          `to create a separate one, pass \`--slug <other-name>\`.`,
      )
    }

    if (msg.includes('violates') || msg.includes('policy') || msg.includes('row-level')) {
      // The policy is "free: max 1" (supabase/migrations/0002_rls_policies.sql):
      // is_pro(uid) OR count(owned projects) < 1. This said "limited to 2",
      // which is not the number enforced anywhere.
      throw new Error(
        `Free tier is limited to 1 project. Upgrade to Pro (5 seats) or Team to create more.`,
      )
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
 * Find a project by ID, but ONLY if the given user is the owner or an active
 * `team_members` row exists for (userId, projectId).
 *
 * Membership is decided by the `is_project_member(uid, pid)` RPC
 * (supabase/migrations/0053), which is `SECURITY DEFINER` and checks
 * "active team member OR project owner". Because it is SECURITY DEFINER it
 * returns the same authoritative answer under BOTH a normal authenticated
 * client (RLS applies elsewhere) and an RLS-bypassing service-role client
 * (`TAGES_SERVICE_KEY`) — so this check is NOT defeated when RLS is off, and
 * it has no false-negatives from `team_members` read-RLS. The gate FAILS
 * CLOSED: any RPC error or a non-`true` result → treated as "not a member".
 *
 * Note this is a convenience gate (it decides whether to write a local
 * project config), not the security boundary — server-side RLS on the
 * memory tables, evaluated against the session's real `auth.uid()`, is what
 * actually protects project data. A non-member — whether the project is
 * real-but-not-theirs or the UUID doesn't exist — gets an indistinguishable
 * `null`, which never discloses whether a UUID belongs to someone else.
 */
export async function findMemberProjectById(
  projectId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<MemberProject | null> {
  const { data: isMember, error: memberError } = await Promise.resolve(
    supabase.rpc('is_project_member', { uid: userId, pid: projectId })
  )

  // Fail closed: a transient RPC error or any non-true result is a reject,
  // never an admit. (A legit member on a transient error simply re-runs.)
  if (memberError || isMember !== true) {
    return null
  }

  const { data, error } = await Promise.resolve(
    supabase.from('projects').select('id, slug, plan').eq('id', projectId).single()
  )

  if (error || !data) {
    return null
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
