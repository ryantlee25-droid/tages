const PROBLEMS = [
  {
    title: 'Context amnesia costs hours',
    description: 'Every new AI session starts from scratch. The same questions get asked, the same codebase gets re-explored.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Naming conventions ignored',
    description: 'Your agent invented camelCase endpoints yesterday. Today it\'s writing snake_case. Last week it was kebab-case.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    title: 'Same bugs reintroduced',
    description: 'You fixed that race condition last month. Your agent just recreated it because it never knew.',
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135c-.22-2.058-1.792-3.555-3.805-3.555h-6.5c-2.013 0-3.585 1.497-3.805 3.555a23.91 23.91 0 01-1.152 6.135A23.932 23.932 0 0112 12.75z" />
      </svg>
    ),
  },
]

export function Problem() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-3xl font-bold text-white">
          AI agents have goldfish memory
        </h2>
        <p className="mt-3 text-center text-zinc-400">
          Every session starts over. Your codebase knowledge vanishes between conversations.
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-xl border border-zinc-800 p-6">
              <div style={{ color: '#3BA3C7' }}>{p.icon}</div>
              <h3 className="mt-4 text-lg font-semibold text-white">{p.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
