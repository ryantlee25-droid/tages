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
 * This deliberately does NOT re-implement that membership check in
 * JavaScript. The `projects` table's RLS policy ("Users can read own
 * projects", supabase/migrations/0002_rls_policies.sql, using
 * `owner_id = auth.uid() or is_project_member(auth.uid(), id)`, with
 * `is_project_member` hardened in migrations 0051/0053 to require
 * `status = 'active'`) is the sole source of truth for whether this row is
 * visible to the caller. `supabase` MUST be an authenticated client (its
 * session bound to `userId` via `auth.setSession`/`createAuthenticatedClient`)
 * for RLS to apply that check — a row coming back at all IS the membership
 * proof. A non-member querying either a real project they can't see, or a
 * project ID that doesn't exist at all, gets an indistinguishable "not
 * found" result here, which is the correct, non-leaking behavior (it never
 * discloses whether a given UUID belongs to *someone else's* project).
 *
 * `userId` is accepted for logging/telemetry symmetry with other call sites
 * in this module, not because the query needs it — trusting a
 * client-supplied `userId` instead of the session's own `auth.uid()` would
 * reintroduce exactly the "trust the client" bug this helper exists to
 * avoid.
 */
export async function findMemberProjectById(
  projectId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<MemberProject | null> {
  void userId // see doc comment: intentionally not used to gate the query

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
