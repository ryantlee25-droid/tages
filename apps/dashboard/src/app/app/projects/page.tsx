import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: projects } = await supabase
    .from('projects')
    .select('*, memories(count)')
    .eq('owner_id', user!.id)
    .order('updated_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Projects</h1>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-12 text-center">
          <h2 className="text-lg font-medium text-zinc-300">No projects yet</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Run <code className="rounded bg-zinc-800 px-1.5 py-0.5">tages init</code> in
            your project directory to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: Record<string, unknown>) => (
            <Link
              key={project.id as string}
              href={`/app/projects/${project.slug}`}
              className="rounded-lg border border-zinc-800 p-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
            >
              <h3 className="font-medium text-white">{project.name as string}</h3>
              <p className="mt-1 text-xs text-zinc-500">{project.slug as string}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
                <span>
                  {(project.memories as Array<{ count: number }>)?.[0]?.count ?? 0} memories
                </span>
                <span>
                  {new Date(project.updated_at as string).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
