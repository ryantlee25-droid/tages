import Link from 'next/link'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For individual developers',
    features: ['1 project', '500 memories', 'MCP server + CLI', 'Local SQLite cache', 'Community support'],
    cta: 'Get started',
    href: '/auth/login',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$9',
    period: '/month',
    description: 'For power users and teams',
    features: ['Unlimited projects', 'Unlimited memories', 'Team sharing', 'Auto-indexing (git hooks)', 'Priority support'],
    cta: 'Get Pro',
    href: '/api/stripe/checkout',
    highlighted: true,
  },
  {
    name: 'Self-hosted',
    price: '$0',
    period: 'forever',
    description: 'Bring your own Supabase',
    features: ['Everything free', 'Your own database', 'Full data ownership', 'No usage limits', 'Community support'],
    cta: 'View docs',
    href: 'https://github.com/ryantlee25-droid/tages',
    highlighted: false,
  },
]

export function Pricing() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-3xl font-bold text-white">Simple pricing</h2>
        <p className="mt-3 text-center text-zinc-400">
          Free for individuals. Pro for teams. Self-host for full control.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
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
              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
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
