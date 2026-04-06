import Link from 'next/link'

export default function UpgradePage() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-white">Upgrade to Pro</h1>
        <p className="mt-3 text-zinc-400">
          Unlimited projects, unlimited memories, team sharing, and cloud sync across devices.
        </p>
        <div className="mt-6">
          <span className="text-4xl font-bold text-white">$9</span>
          <span className="text-zinc-400">/month</span>
        </div>
        <ul className="mt-6 space-y-2 text-left text-sm text-zinc-300">
          {[
            'Unlimited projects',
            'Unlimited memories',
            'Team sharing',
            'Cloud sync across devices',
            'Priority support',
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" style={{ color: '#3BA3C7' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <Link
          href="/api/stripe/checkout"
          className="mt-8 block rounded-lg py-3 text-center text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          Get Pro
        </Link>
        <Link href="/app/projects" className="mt-3 block text-sm text-zinc-500 hover:text-zinc-300">
          Maybe later
        </Link>
      </div>
    </div>
  )
}
