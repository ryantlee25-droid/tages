import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ActivityFeed } from '@/components/activity-feed'
import { ProjectNav } from '@/components/project-nav'

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!project) notFound()

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-white">{project.name}</h1>
      <ProjectNav slug={slug} active="activity" />
      <ActivityFeed projectId={project.id} />
    </div>
  )
}
