import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ProjectNav } from '@/components/project-nav'
import { ConflictResolver } from '@/components/conflict-resolver'

export default async function ConflictsPage({
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
      <ProjectNav slug={slug} active="conflicts" projectId={project.id} />
      <ConflictResolver projectId={project.id} />
    </div>
  )
}
