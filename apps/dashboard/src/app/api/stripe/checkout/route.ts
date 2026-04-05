import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Stripe is not configured yet — stub for demo
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRO_PRICE_ID) {
    const origin = new URL(request.url).origin
    // For demo: auto-upgrade to Pro
    const adminClient = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await adminClient.from('user_profiles').upsert({
      user_id: user.id,
      is_pro: true,
      pro_since: new Date().toISOString(),
    })
    return NextResponse.redirect(`${origin}/app/projects?upgraded=true`, 303)
  }

  // Real Stripe flow
  const { getStripe } = await import('@/lib/stripe')
  const stripe = getStripe()
  const origin = new URL(request.url).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    metadata: { user_id: user.id },
    line_items: [{
      price: process.env.STRIPE_PRO_PRICE_ID!,
      quantity: 1,
    }],
    success_url: `${origin}/app/projects?upgraded=true`,
    cancel_url: `${origin}/app/upgrade`,
  })

  return NextResponse.redirect(session.url!, 303)
}
