import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const origin = new URL(request.url).origin

  // Look up customer ID from user_profiles (written by the webhook on checkout).
  // Email lookup is ambiguous (email can change, duplicates possible across environments).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  const customerId = profile?.stripe_customer_id
  if (!customerId) {
    return NextResponse.redirect(`${origin}/app/upgrade`)
  }

  const stripe = getStripe()
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/app/projects`,
  })

  return NextResponse.redirect(session.url, 303)
}
