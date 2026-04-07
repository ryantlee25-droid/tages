'use client'

interface TeamMember {
  email: string
  role: string
  createdAt: string
}

interface WeeklyMemory {
  source: string
  count: number
}

interface TopRecalled {
  key: string
  count: number
}

interface TeamOverviewProps {
  members: TeamMember[]
  weeklyMemories: WeeklyMemory[]
  topRecalled: TopRecalled[]
  projectSlug: string
}

export function TeamOverview({
  members,
  weeklyMemories,
  topRecalled,
  projectSlug,
}: TeamOverviewProps) {
  return (
    <div className="space-y-8">
      {/* Members Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Members</h2>
        {members.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No team members yet. Run{' '}
            <code className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-300 text-xs">
              tages init --team
            </code>{' '}
            to invite teammates.
          </p>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {members.map((member) => (
                  <tr key={member.email} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3 text-zinc-200">{member.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          member.role === 'owner'
                            ? 'bg-violet-900/50 text-violet-300'
                            : member.role === 'admin'
                              ? 'bg-blue-900/50 text-blue-300'
                              : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Weekly Activity Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Weekly Activity</h2>
        {weeklyMemories.length === 0 ? (
          <p className="text-sm text-zinc-500">No memories recorded this week.</p>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Source / Agent
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Memories (7d)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {weeklyMemories
                  .sort((a, b) => b.count - a.count)
                  .map((item) => (
                    <tr key={item.source} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-200">{item.source}</td>
                      <td className="px-4 py-3 text-right text-zinc-300 font-mono">{item.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Top Recalled Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Top Recalled</h2>
        {topRecalled.length === 0 ? (
          <p className="text-sm text-zinc-500">No recall data yet for {projectSlug}.</p>
        ) : (
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Memory Key
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Recall Count
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {topRecalled
                  .sort((a, b) => b.count - a.count)
                  .map((item) => (
                    <tr key={item.key} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="px-4 py-3 text-zinc-200 font-mono text-xs">{item.key}</td>
                      <td className="px-4 py-3 text-right text-zinc-300 font-mono">{item.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
