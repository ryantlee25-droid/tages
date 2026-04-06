import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SsoConfigPanel } from '@/components/sso-config-panel'

export default async function SsoSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_pro')
    .eq('user_id', user.id)
    .single()

  const isPro = profile?.is_pro ?? false

  if (!isPro) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
          <svg className="h-6 w-6 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white">SSO / SAML is a Pro feature</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Upgrade to Pro to configure SAML single sign-on for your organization.
        </p>
        <Link
          href="/app/upgrade"
          className="mt-6 inline-block rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          Upgrade to Pro
        </Link>
      </div>
    )
  }

  return <SsoConfigPanel />
}
