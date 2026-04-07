import Link from 'next/link'

const PLANS = [
  {
    name: 'Pro',
    price: '$14',
    period: '/month',
    description: 'For professional developers.',
    features: [
      'Unlimited projects',
      '50,000 memories',
      'Supabase cloud sync',
      'Fuzzy + semantic search',
      'Memory quality scoring',
      'Priority support',
    ],
    href: '/api/stripe/checkout?plan=pro',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$29',
    period: '/seat/mo',
    description: 'For shared codebases.',
    features: [
      'Everything in Pro',
      '100,000 memories per project',
      'Team memory federation',
      'RBAC + audit logging',
      'SSO (SAML/OIDC)',
      'Dashboard analytics',
    ],
    href: 'mailto:support@tages.dev?subject=Tages Team plan',
    highlighted: false,
  },
]

export default function UpgradePage() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-2xl">
        <h1 className="text-center text-3xl font-bold text-white">Upgrade your plan</h1>
        <p className="mt-3 text-center text-zinc-400">
          Full features at every paid tier. No paywalls.
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-xl border p-6 ${
                plan.highlighted ? 'border-[#3BA3C7] bg-zinc-900/50' : 'border-zinc-800'
              }`}
            >
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
                {plan.highlighted ? 'Get Pro' : 'Contact us'}
              </Link>
            </div>
          ))}
        </div>
        <Link href="/app/projects" className="mt-6 block text-center text-sm text-zinc-500 hover:text-zinc-300">
          Maybe later
        </Link>
      </div>
    </div>
  )
}
