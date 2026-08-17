import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

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
        <div className="rounded-lg border border-zinc-800 p-8 text-center max-w-4xl mx-auto">
          <div className="text-4xl mb-4">🧒</div>
          <h2 className="text-lg font-medium text-zinc-300">Welcome to Tages</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Give your AI tools persistent memory about your codebase.
          </p>

          <div className="mt-6 mx-auto max-w-md rounded-lg bg-zinc-800/50 p-4 text-left">
            <p className="text-xs font-medium text-zinc-300 mb-2">First, install the CLI</p>
            <code className="text-xs text-[#3BA3C7]">npm install -g @tages/cli</code>
          </div>

          <p className="mt-6 text-sm text-zinc-400">
            Then pick the path that matches you.
          </p>

          <div className="mt-4 grid gap-4 text-left sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 p-4">
              <h3 className="text-sm font-medium text-white">Starting your own project</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Nobody on your team has set up Tages for this repo yet.
              </p>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-zinc-800/50 p-3">
                  <p className="text-xs font-medium text-zinc-300 mb-2">1. Create the project</p>
                  <code className="text-xs text-[#3BA3C7]">cd your-project && tages init</code>
                </div>
                <div className="rounded-lg bg-zinc-800/50 p-3">
                  <p className="text-xs font-medium text-zinc-300 mb-2">2. Store your first memory</p>
                  <code className="text-xs text-[#3BA3C7]">tages remember &quot;uses-pnpm&quot; &quot;This project uses pnpm&quot;</code>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                <code className="rounded bg-zinc-800 px-1">tages init</code> claims the project
                name for your whole team. Names are unique across all of Tages, so only one
                person should run it per repo.
              </p>
            </div>

            <div className="rounded-lg border border-zinc-800 p-4">
              <h3 className="text-sm font-medium text-white">Joining a teammate&apos;s project</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Someone on your team already ran <code className="rounded bg-zinc-800 px-1">tages init</code> for this repo.
              </p>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg bg-zinc-800/50 p-3">
                  <p className="text-xs font-medium text-zinc-300 mb-2">1. Ask your team for the project ID</p>
                  <p className="text-xs text-zinc-400">
                    A project owner or admin can give you the ID (a UUID). Ask them to add you to
                    the project as well: <code className="text-[#3BA3C7]">tages team invite &lt;your-email&gt;</code>
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-800/50 p-3">
                  <p className="text-xs font-medium text-zinc-300 mb-2">2. Join the project</p>
                  <code className="text-xs text-[#3BA3C7]">cd your-project && tages link --project-id &lt;uuid&gt;</code>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                Do not run <code className="rounded bg-zinc-800 px-1">tages init</code> to join. It
                tries to create a second project with a name that is already taken, and the failure
                is sometimes misreported as a plan limit.{' '}
                <code className="rounded bg-zinc-800 px-1">tages link</code> signs you in with
                GitHub if you have no session yet, so it can be your very first command.
              </p>
            </div>
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Run either path from your own work repo, the one you want your AI tools to remember,
            not from a checkout of Tages itself. Your projects appear here as soon as the command
            finishes.
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
