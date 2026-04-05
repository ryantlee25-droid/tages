import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const stripe = getStripe()
  const origin = new URL(request.url).origin

  // Find or create Stripe customer
  const customers = await stripe.customers.list({ email: user.email!, limit: 1 })
  const customer = customers.data[0]

  if (!customer) {
    return NextResponse.redirect(`${origin}/app/upgrade`)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: `${origin}/app/projects`,
  })

  return NextResponse.redirect(session.url, 303)
}
