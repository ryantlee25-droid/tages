import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PRICE_MAP: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRO_PRICE_ID,
  team: process.env.STRIPE_TEAM_PRICE_ID,
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Determine plan from query param (default: pro)
  const url = new URL(request.url)
  const plan = url.searchParams.get('plan') || 'pro'

  if (plan !== 'pro' && plan !== 'team') {
    return NextResponse.json({ error: 'Invalid plan. Use "pro" or "team".' }, { status: 400 })
  }

  // Stripe not configured — reject unless TAGES_DEMO_MODE is explicitly enabled
  if (!process.env.STRIPE_SECRET_KEY || !PRICE_MAP[plan]) {
    if (process.env.TAGES_DEMO_MODE !== 'true') {
      return NextResponse.json(
        { error: 'Billing is not configured. Set TAGES_DEMO_MODE=true to enable demo upgrades.' },
        { status: 503 },
      )
    }
    const origin = url.origin
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await adminClient.from('user_profiles').upsert({
      user_id: user.id,
      is_pro: true,
      plan,
      pro_since: new Date().toISOString(),
    })
    return NextResponse.redirect(`${origin}/app/projects?upgraded=true`, 303)
  }

  // Real Stripe flow
  const { getStripe } = await import('@/lib/stripe')
  const stripe = getStripe()
  const origin = url.origin

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    metadata: { user_id: user.id, plan },
    line_items: [{
      price: PRICE_MAP[plan]!,
      quantity: 1,
    }],
    success_url: `${origin}/app/projects?upgraded=true`,
    cancel_url: `${origin}/app/upgrade`,
  })

  return NextResponse.redirect(session.url!, 303)
}
