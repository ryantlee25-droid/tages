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

  const rawQuantity = url.searchParams.get('quantity')
  let quantity = rawQuantity ? parseInt(rawQuantity, 10) : 1
  if (isNaN(quantity) || quantity < 1) quantity = 1

  if (plan === 'pro') {
    quantity = 1
  }

  if (plan === 'team' && (quantity < 1 || quantity > 20)) {
    return NextResponse.json({ error: 'Team plan requires 1–20 seats' }, { status: 400 })
  }

  // Demo-mode fallback (no Stripe credentials configured)
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
    await adminClient
      .from('projects')
      .update({ plan })
      .eq('owner_id', user.id)
    return NextResponse.redirect(`${origin}/app/projects?upgraded=true`, 303)
  }

  const { getStripe } = await import('@/lib/stripe')
  const stripe = getStripe()
  const origin = url.origin

  // If user already has an active subscription, update it in place instead
  // of creating a duplicate. Stripe handles proration automatically.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_subscription_id, subscription_status')
    .eq('user_id', user.id)
    .single()

  const hasActiveSub = profile?.stripe_subscription_id
    && (profile.subscription_status === 'active' || profile.subscription_status === 'trialing')

  if (hasActiveSub) {
    // Fetch the existing subscription to get its item ID, then swap the price.
    const existing = await stripe.subscriptions.retrieve(profile.stripe_subscription_id!)
    const itemId = existing.items.data[0]?.id
    if (!itemId) {
      return NextResponse.json({ error: 'Existing subscription has no line items' }, { status: 500 })
    }

    await stripe.subscriptions.update(profile.stripe_subscription_id!, {
      items: [{ id: itemId, price: PRICE_MAP[plan]!, quantity }],
      proration_behavior: 'create_prorations',
      metadata: { user_id: user.id, plan },
    })

    // Webhook fires customer.subscription.updated to sync the DB.
    return NextResponse.redirect(`${origin}/app/upgrade?updated=true`, 303)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    metadata: { user_id: user.id, plan },
    subscription_data: {
      metadata: { user_id: user.id, plan },
    },
    line_items: [{
      price: PRICE_MAP[plan]!,
      quantity,
    }],
    success_url: `${origin}/app/projects?upgraded=true`,
    cancel_url: `${origin}/app/upgrade`,
  })

  return NextResponse.redirect(session.url!, 303)
}

export const GET = POST
