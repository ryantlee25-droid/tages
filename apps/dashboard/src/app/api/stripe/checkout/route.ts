import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
