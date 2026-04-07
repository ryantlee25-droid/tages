import { createClient } from '@/lib/supabase/server'
import { TeamOverview } from '@/components/team-overview'

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  // Get project
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('slug', slug)
    .single()

  if (!project) return <div className="p-8 text-zinc-400">Project not found</div>

  // Get team members
  const { data: members } = await supabase
    .from('team_members')
    .select('*')
    .eq('project_id', project.id)

  // Get memories created this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentMemories } = await supabase
    .from('memories')
    .select('source, agent_name')
    .eq('project_id', project.id)
    .gte('created_at', weekAgo)

  // Count by source/agent
  const weeklyMemories = Object.entries(
    (recentMemories || []).reduce(
      (acc, m) => {
        const key = m.agent_name || m.source || 'unknown'
        acc[key] = (acc[key] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    ),
  ).map(([source, count]) => ({ source, count }))

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Team — {slug}</h1>
      <TeamOverview
        members={(members || []).map((m) => ({
          email: m.email || m.user_id || 'Unknown',
          role: m.role,
          createdAt: m.created_at,
        }))}
        weeklyMemories={weeklyMemories}
        topRecalled={[]}
        projectSlug={slug}
      />
    </div>
  )
}
