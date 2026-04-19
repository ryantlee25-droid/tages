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

  const url = new URL(request.url)
  const plan = url.searchParams.get('plan') || 'pro'

  if (plan !== 'pro' && plan !== 'team') {
    return NextResponse.json({ error: 'Invalid plan. Use "pro" or "team".' }, { status: 400 })
  }

  // Parse quantity param
  const rawQuantity = url.searchParams.get('quantity')
  let quantity = rawQuantity ? parseInt(rawQuantity, 10) : 1
  if (isNaN(quantity) || quantity < 1) quantity = 1

  // Pro always has quantity 1
  if (plan === 'pro') {
    quantity = 1
  }

  // Team: validate seat count
  if (plan === 'team' && (quantity < 1 || quantity > 20)) {
    return NextResponse.json({ error: 'Team plan requires 1–20 seats' }, { status: 400 })
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
      subscription_quantity: quantity,
    })
    // Also propagate plan to owned projects
    await adminClient
      .from('projects')
      .update({ plan })
      .eq('owner_id', user.id)
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
      quantity,
    }],
    success_url: `${origin}/app/projects?upgraded=true`,
    cancel_url: `${origin}/app/upgrade`,
  })

  return NextResponse.redirect(session.url!, 303)
}
