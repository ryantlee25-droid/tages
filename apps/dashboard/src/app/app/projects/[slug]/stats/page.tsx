import { createClient } from '@/lib/supabase/server'
import { isValidSlug } from '@/lib/validate-slug'
import { notFound } from 'next/navigation'
import { StatsDashboard } from '@/components/stats-dashboard'
import { ProjectNav } from '@/components/project-nav'

export default async function StatsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (!isValidSlug(slug)) notFound()

  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!project) {
    notFound()
  }

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-white">{project.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">{project.git_remote || project.slug}</p>
      </div>

      <ProjectNav slug={slug} active="stats" projectId={project.id} />

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white">Memory Stats</h2>
        <p className="mt-0.5 text-sm text-zinc-400">
          Breakdown of stored memories by type, confidence, and agent.
        </p>
      </div>

      <StatsDashboard projectId={project.id} />
    </div>
  )
}
