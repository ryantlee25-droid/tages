import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TeamPlanCard } from '@/components/upgrade/team-plan-card'

// Always re-query plan state on each render so post-upgrade redirects
// reflect the new tier as soon as the webhook updates user_profiles.
export const dynamic = 'force-dynamic'

const PRO_FEATURES = [
  'Up to 10 projects',
  '50,000 memories',
  'Supabase cloud sync',
  'Fuzzy + semantic search',
  'Memory quality scoring',
  'Priority support',
]

export default async function UpgradePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan, stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  const currentPlan = profile?.plan ?? 'free'
  const hasSubscription = Boolean(profile?.stripe_customer_id)

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-2xl">
        <h1 className="text-center text-3xl font-bold text-white">
          {currentPlan === 'free' ? 'Upgrade your plan' : 'Change your plan'}
        </h1>
        <p className="mt-3 text-center text-zinc-400">
          Full features at every paid tier. No paywalls.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {/* Pro card */}
          <div
            className={`flex flex-col rounded-xl border p-6 ${
              currentPlan === 'pro'
                ? 'border-zinc-600 bg-zinc-900/30'
                : 'border-[#3BA3C7] bg-zinc-900/50'
            }`}
          >
            <h3 className="text-lg font-semibold text-white">Pro</h3>
            <div className="mt-2">
              <span className="text-3xl font-bold text-white">$14</span>
              <span className="text-sm text-zinc-500">/month</span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">For professional developers.</p>
            <ul className="mt-6 flex-1 space-y-2">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-zinc-300">
                  <svg
                    className="h-4 w-4 shrink-0"
                    style={{ color: '#3BA3C7' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            {currentPlan === 'pro' ? (
              <div className="mt-6 block rounded-lg border border-zinc-700 py-2.5 text-center text-sm font-medium text-zinc-500">
                Current plan
              </div>
            ) : (
              <Link
                href="/api/stripe/checkout?plan=pro"
                className="mt-6 block rounded-lg py-2.5 text-center text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: '#3BA3C7' }}
              >
                Get Pro
              </Link>
            )}
            <p className="mt-4 text-xs text-zinc-500">
              Email{' '}
              <a href="mailto:support@tages.ai" className="text-[#3BA3C7] hover:underline">
                support@tages.ai
              </a>
            </p>
          </div>

          {/* Team card (client component with seat picker, or current-plan view) */}
          {currentPlan === 'team' ? (
            <div className="flex flex-col rounded-xl border border-zinc-600 bg-zinc-900/30 p-6">
              <h3 className="text-lg font-semibold text-white">Team</h3>
              <div className="mt-2">
                <span className="text-3xl font-bold text-white">$19</span>
                <span className="text-sm text-zinc-500">/seat/mo</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">For shared codebases.</p>
              <p className="mt-6 flex-1 text-sm text-zinc-400">
                Manage seats, change plan, or cancel via the Stripe customer portal.
              </p>
              <Link
                href="/api/stripe/portal"
                className="mt-6 block rounded-lg py-2.5 text-center text-sm font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: '#3BA3C7' }}
              >
                Manage subscription
              </Link>
            </div>
          ) : (
            <TeamPlanCard />
          )}
        </div>

        {hasSubscription && currentPlan !== 'team' && (
          <Link
            href="/api/stripe/portal"
            className="mt-6 block text-center text-sm text-zinc-400 hover:text-zinc-200"
          >
            Manage subscription →
          </Link>
        )}

        <Link
          href="/app/projects"
          className="mt-6 block text-center text-sm text-zinc-500 hover:text-zinc-300"
        >
          Maybe later
        </Link>
      </div>
    </div>
  )
}
