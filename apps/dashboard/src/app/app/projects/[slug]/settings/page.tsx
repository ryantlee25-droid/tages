import { createClient } from '@/lib/supabase/server'
import { isValidSlug } from '@/lib/validate-slug'
import { notFound } from 'next/navigation'
import { ProjectNav } from '@/components/project-nav'
import { TeamMembers } from '@/components/team-members'
import { ProjectSettingsForm } from '@/components/project-settings-form'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (!isValidSlug(slug)) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!project) notFound()

  const isOwner = project.owner_id === user?.id

  let currentUserRole: 'owner' | 'admin' | 'member' = 'member'
  if (isOwner) {
    currentUserRole = 'owner'
  } else if (user) {
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()
    if (membership) {
      currentUserRole = membership.role as 'owner' | 'admin' | 'member'
    }
  }

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-white">{project.name}</h1>
      <ProjectNav slug={slug} active="settings" projectId={project.id} />

      <div className="max-w-2xl space-y-8">
        {/* Project info */}
        <div>
          <h3 className="text-lg font-medium text-white">Project</h3>
          <div className="mt-3 space-y-2 text-sm text-zinc-400">
            <p><span className="text-zinc-500">Slug:</span> {project.slug}</p>
            <p><span className="text-zinc-500">Created:</span> {new Date(project.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Editable settings */}
        <div>
          <h3 className="mb-3 text-lg font-medium text-white">Settings</h3>
          <ProjectSettingsForm
            project={{
              id: project.id,
              name: project.name,
              git_remote: project.git_remote ?? null,
              default_branch: project.default_branch ?? 'main',
            }}
            isOwner={isOwner}
          />
        </div>

        {/* Team */}
        <TeamMembers projectId={project.id} currentUserRole={currentUserRole} />
      </div>
    </div>
  )
}
