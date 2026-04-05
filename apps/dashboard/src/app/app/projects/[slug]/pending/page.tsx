import { createClient } from '@/lib/supabase/server'
import { isValidSlug } from '@/lib/validate-slug'
import { notFound } from 'next/navigation'
import { PendingQueue } from '@/components/pending-queue'
import { ProjectNav } from '@/components/project-nav'

export default async function PendingPage({
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

      <ProjectNav slug={slug} active="pending" projectId={project.id} />

      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">Pending Review</h2>
        <p className="mt-0.5 text-sm text-zinc-400">
          Auto-extracted memories awaiting verification before appearing in recall.
        </p>
      </div>

      <PendingQueue projectId={project.id} />
    </div>
  )
}
