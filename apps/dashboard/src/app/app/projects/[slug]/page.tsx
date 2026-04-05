import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { MemoryTable } from '@/components/memory-table'
import { ProjectNav } from '@/components/project-nav'

export default async function ProjectPage({
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

  if (!project) {
    notFound()
  }

  return (
    <div className="p-8">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-white">{project.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">{project.git_remote || project.slug}</p>
      </div>

      <ProjectNav slug={slug} active="memories" />

      <MemoryTable projectId={project.id} />
    </div>
  )
}
