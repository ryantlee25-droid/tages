import Link from 'next/link'

const VALUES = [
  {
    title: 'Any model. Any machine.',
    description: 'Claude, Qwen, DeepSeek, Codex — one memory set works across every MCP-compatible tool. Switch models or machines without losing context. Cloud sync keeps memories in sync wherever you code.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: 'Proven quality impact',
    description: 'Agents scored up to 9.1/10 with Tages vs 2.8/10 without. Quality delta scales from +1.0 on simple tasks to +6.3 on complex ones.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    title: 'Local-first, sub-10ms',
    description: 'SQLite cache means your agent never waits. Works fully offline. Supabase syncs in the background when connected — memories follow you across machines.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: 'Built for teams',
    description: 'RBAC, federation, shared dashboards, convention enforcement. One developer\'s decision becomes every agent\'s context.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
]

export function ValueProps() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-3xl font-bold text-white">
          Why teams choose Tages
        </h2>
        <p className="mt-3 text-center text-zinc-400">
          Not just another dev tool. Measurably better AI output.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-xl border border-zinc-800 p-6">
              <div style={{ color: '#3BA3C7' }}>{v.icon}</div>
              <h3 className="mt-4 text-lg font-semibold text-white">{v.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{v.description}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/examples" className="text-sm hover:underline" style={{ color: '#3BA3C7' }}>
            See real memory examples →
          </Link>
        </div>
      </div>
    </section>
  )
}
