const STEPS = [
  {
    step: 1,
    title: 'Add to Claude Code',
    code: `claude mcp add tages -- npx -y @tages/server\n\n# Or install the full CLI:\nnpm install -g @tages/cli && tages init`,
    description: 'MCP-only path needs no account. Or install the CLI and run tages init for cloud sync + dashboard.',
  },
  {
    step: 2,
    title: 'Remember',
    code: `tages remember "auth-pattern" \\\n  "JWT in httpOnly cookie, refresh via /api/auth/refresh" \\\n  --type convention`,
    description: 'Store conventions, decisions, and architecture notes. Git hooks auto-extract from commits.',
  },
  {
    step: 3,
    title: 'Recall',
    code: `# In any AI session, weeks later:\n> "How does auth work in this project?"\n\n# Agent recalls via MCP:\n[convention] auth-pattern\n  JWT in httpOnly cookie, refresh via /api/auth/refresh`,
    description: 'Every new session starts with full context. No re-explanation needed.',
  },
]

export function HowItWorks() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-bold text-white">
          How it works
        </h2>
        <div className="mt-12 space-y-12">
          {STEPS.map((s) => (
            <div key={s.step} className="flex gap-6">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
                style={{ backgroundColor: '#3BA3C7' }}
              >
                {s.step}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white">{s.title}</h3>
                <p className="mt-1 text-sm text-zinc-400">{s.description}</p>
                <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-xs sm:text-sm text-zinc-300">
                  {s.code}
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
