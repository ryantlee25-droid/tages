import Link from 'next/link'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For solo developers. No account needed.',
    features: [
      'Up to 2 projects',
      '10,000 memories',
      '20 core MCP tools',
      'SQLite local-only',
      'tages brief generation',
      'Community support',
    ],
    cta: 'Get started',
    href: '/auth/login',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$14',
    period: '/month',
    description: 'For professional developers.',
    features: [
      'All 56 MCP tools',
      'Up to 10 projects',
      '50,000 memories',
      'Supabase cloud sync',
      'Fuzzy + semantic search',
      'Quality scoring + analytics',
    ],
    cta: 'Start free trial',
    href: '/api/stripe/checkout?plan=pro',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$29',
    period: '/seat/mo',
    description: 'For shared codebases.',
    badge: 'Coming soon',
    features: [
      'Everything in Pro',
      'Up to 20 projects',
      '100,000 memories per project',
      'Team memory federation',
      'RBAC + audit logging',
      'SSO (SAML/OIDC)',
    ],
    cta: 'Join waitlist',
    href: 'mailto:support@tages.dev',
    highlighted: false,
  },
  {
    name: 'Self-hosted',
    price: '$0',
    period: 'forever',
    description: 'Your infrastructure, your data.',
    features: [
      'Full feature parity',
      'No memory limits',
      'AES-256 encryption',
      'Air-gapped compatible',
      'MIT license',
      'Community support',
    ],
    cta: 'View setup guide',
    href: 'https://github.com/ryantlee25-droid/tages/blob/main/docs/self-hosting.md',
    highlighted: false,
  },
]

const COMPARISON = [
  { feature: 'Free tier', tages: '10K memories', mempalace: 'Unlimited', mem0: '10K memories', zep: '1K credits', supermemory: '1M tokens' },
  { feature: 'Paid entry', tages: '$14/mo', mempalace: 'Free', mem0: '$19/mo', zep: '$25/mo', supermemory: '$19/mo' },
  { feature: 'Team sharing', tages: 'RBAC + federation', mempalace: 'None', mem0: 'None', zep: 'None', supermemory: 'None' },
  { feature: 'Dashboard', tages: 'Full (Next.js)', mempalace: 'None', mem0: 'Basic', zep: 'None', supermemory: 'Basic' },
  { feature: 'MCP tools', tages: '56', mempalace: '19', mem0: 'N/A', zep: 'N/A', supermemory: 'N/A' },
  { feature: 'Quality control', tages: 'Audit + sharpen', mempalace: 'None', mem0: 'None', zep: 'None', supermemory: 'None' },
  { feature: 'Self-hosted', tages: 'Free (MIT)', mempalace: 'Free (MIT)', mem0: 'Apache 2.0', zep: 'Graphiti only', supermemory: 'Open core' },
  { feature: 'Coding focus', tages: 'Purpose-built', mempalace: 'General', mem0: 'General', zep: 'General', supermemory: 'Plugin' },
  { feature: 'Delivery', tages: 'System prompt', mempalace: 'MCP', mem0: 'MCP / API', zep: 'API', supermemory: 'MCP / API' },
]

const FAQ = [
  {
    q: 'Why is Tages so much cheaper than Mem0 or Zep?',
    a: 'Tages is built specifically for coding agent memory, not general-purpose AI memory. We don\'t need to support chatbot personalization, CRM integration, or enterprise copilot workflows. That focus means less infrastructure complexity and lower costs passed to you.',
  },
  {
    q: 'What happens if I exceed my memory limit?',
    a: 'On Free, older memories are archived when you hit the cap. On Pro, you get a warning at 80% and can upgrade or clean up. Team caps at 100K memories per project.',
  },
  {
    q: 'Can I migrate from Mem0 or Zep?',
    a: 'Yes. Tages supports importing memories via CLI or API. Memory types map cleanly from most platforms.',
  },
  {
    q: 'What does "system prompt injection" mean?',
    a: 'Our benchmarks proved that MCP tool calls at runtime don\'t improve agent code quality. tages brief generates a cached context file injected into the system prompt, keeping project knowledge pinned at the top of every turn.',
  },
  {
    q: 'Is self-hosted really free?',
    a: 'Yes. MIT license, no usage limits, no phone-home. Bring your own Supabase instance (free tier works) and you have full Tages with zero cost.',
  },
]

export function Pricing() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-3xl font-bold text-white">Simple pricing</h2>
        <p className="mt-3 text-center text-zinc-400">
          Start free with 20 core tools. Upgrade for team sharing and advanced features.
        </p>

        {/* Plan cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-xl border p-6 ${
                plan.highlighted
                  ? 'border-[#3BA3C7] bg-zinc-900/50'
                  : 'border-zinc-800'
              }`}
            >
              {plan.highlighted && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: '#3BA3C7' }}
                >
                  Most popular
                </span>
              )}
              {'badge' in plan && plan.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-zinc-600 bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                  {plan.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
                {' '}
                <span className="text-sm text-zinc-500">{plan.period}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">{plan.description}</p>
              <ul className="mt-6 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                    <svg className="h-4 w-4 shrink-0" style={{ color: '#3BA3C7' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                target={plan.href.startsWith('http') || plan.href.startsWith('mailto') ? '_blank' : undefined}
                rel={plan.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className={`mt-6 block rounded-lg py-2.5 text-center text-sm font-medium transition-colors ${
                  plan.highlighted
                    ? 'text-white hover:opacity-90'
                    : 'border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                }`}
                style={plan.highlighted ? { backgroundColor: '#3BA3C7' } : undefined}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function PricingComparison() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-3xl font-bold text-white">How Tages compares</h2>
        <p className="mt-3 text-center text-zinc-400">
          The only memory platform built for teams. Others store facts — Tages manages quality.
        </p>

        <div className="mt-12 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="pb-3 pr-6 text-left text-zinc-500 font-medium" />
                <th className="pb-3 px-4 text-left font-semibold" style={{ color: '#3BA3C7' }}>Tages</th>
                <th className="pb-3 px-4 text-left text-zinc-400 font-medium">MemPalace</th>
                <th className="pb-3 px-4 text-left text-zinc-400 font-medium">Mem0</th>
                <th className="pb-3 px-4 text-left text-zinc-400 font-medium">Zep</th>
                <th className="pb-3 px-4 text-left text-zinc-400 font-medium">Supermemory</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.feature} className="border-b border-zinc-800/50">
                  <td className="py-3 pr-6 text-zinc-500 font-medium">{row.feature}</td>
                  <td className="py-3 px-4 text-white font-medium">{row.tages}</td>
                  <td className="py-3 px-4 text-zinc-400">{row.mempalace}</td>
                  <td className="py-3 px-4 text-zinc-400">{row.mem0}</td>
                  <td className="py-3 px-4 text-zinc-400">{row.zep}</td>
                  <td className="py-3 px-4 text-zinc-400">{row.supermemory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export function PricingFAQ() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-bold text-white">FAQ</h2>
        <div className="mt-12 space-y-6">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-zinc-800 p-6">
              <h3 className="font-semibold text-white">{item.q}</h3>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
