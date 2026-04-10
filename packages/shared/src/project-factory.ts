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
    supabase.from('projects').select('id, slug, name').eq('slug', slug).eq('owner_id', userId)
  )

  if (existing && existing.length > 0) {
    return {
      projectId: existing[0].id as string,
      slug,
      supabaseUrl,
      supabaseAnonKey,
      plan: 'free',
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
