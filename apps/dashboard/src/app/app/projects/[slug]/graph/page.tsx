import { createClient } from '@/lib/supabase/server'
import { isValidSlug } from '@/lib/validate-slug'
import { notFound } from 'next/navigation'
import { ProjectNav } from '@/components/project-nav'
import { MemoryGraphView } from '@/components/memory-graph'

export default async function GraphPage({
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

  if (!project) notFound()

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-bold text-white">{project.name}</h1>
      <ProjectNav slug={slug} active="graph" projectId={project.id} />
      <MemoryGraphView projectId={project.id} />
    </div>
  )
}
