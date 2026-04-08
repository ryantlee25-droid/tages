import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Also include projects shared via team_members
  const { data: ownedProjects } = await supabase
    .from('projects')
    .select('*, memories(count)')
    .eq('owner_id', user!.id)
    .order('updated_at', { ascending: false })

  const { data: sharedMemberships } = await supabase
    .from('team_members')
    .select('project_id')
    .eq('user_id', user!.id)

  let sharedProjects: typeof ownedProjects = []
  if (sharedMemberships?.length) {
    const sharedIds = sharedMemberships.map(m => m.project_id)
    const { data } = await supabase
      .from('projects')
      .select('*, memories(count)')
      .in('id', sharedIds)
      .order('updated_at', { ascending: false })
    sharedProjects = data
  }

  const projects = [
    ...(ownedProjects || []).map(p => ({ ...p, _shared: false })),
    ...(sharedProjects || []).map(p => ({ ...p, _shared: true })),
  ]

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Projects</h1>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-12 text-center max-w-lg mx-auto">
          <div className="text-4xl mb-4">🧒</div>
          <h2 className="text-lg font-medium text-zinc-300">Welcome to Tages</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Give your AI tools persistent memory about your codebase.
          </p>
          <div className="mt-6 space-y-3 text-left">
            <div className="rounded-lg bg-zinc-800/50 p-4">
              <p className="text-xs font-medium text-zinc-300 mb-2">1. Install the CLI</p>
              <code className="text-xs text-[#3BA3C7]">npm install -g @tages/cli</code>
            </div>
            <div className="rounded-lg bg-zinc-800/50 p-4">
              <p className="text-xs font-medium text-zinc-300 mb-2">2. Initialize in your project</p>
              <code className="text-xs text-[#3BA3C7]">cd your-project && tages init</code>
            </div>
            <div className="rounded-lg bg-zinc-800/50 p-4">
              <p className="text-xs font-medium text-zinc-300 mb-2">3. Store your first memory</p>
              <code className="text-xs text-[#3BA3C7]">tages remember &quot;uses-pnpm&quot; &quot;This project uses pnpm&quot;</code>
            </div>
          </div>
          <p className="mt-6 text-xs text-zinc-500">
            Your projects will appear here once you run <code className="rounded bg-zinc-800 px-1">tages init</code>.
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
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-white">{project.name as string}</h3>
                {(project._shared as boolean) && (
                  <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 border border-purple-500/20">
                    Shared
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">{project.slug as string}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400">
                <span>
                  {(project.memories as Array<{ count: number }>)?.[0]?.count ?? 0} memories
                </span>
                <span>
                  Created {new Date(project.created_at as string).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
