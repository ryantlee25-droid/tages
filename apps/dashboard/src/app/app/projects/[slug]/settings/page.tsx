import { createClient } from '@/lib/supabase/server'
import { isValidSlug } from '@/lib/validate-slug'
import { notFound } from 'next/navigation'
import { ProjectNav } from '@/components/project-nav'
import { TeamMembers } from '@/components/team-members'

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
            <p><span className="text-zinc-500">Git remote:</span> {project.git_remote || 'Not set'}</p>
            <p><span className="text-zinc-500">Default branch:</span> {project.default_branch}</p>
            <p><span className="text-zinc-500">Created:</span> {new Date(project.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Team */}
        <TeamMembers projectId={project.id} isOwner={isOwner} />
      </div>
    </div>
  )
}
