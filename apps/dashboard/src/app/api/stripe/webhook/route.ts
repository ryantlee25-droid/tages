import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

// Use service role for webhook (no user context)
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const stripe = getStripe()
  let event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  const supabase = getAdminClient()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId = session.metadata?.user_id
      const plan = session.metadata?.plan || 'pro'
      if (userId) {
        await supabase.from('user_profiles').upsert({
          user_id: userId,
          is_pro: true,
          plan,
          pro_since: new Date().toISOString(),
          stripe_customer_id: session.customer as string,
        })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      const customerId = subscription.customer as string

      const { data } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .limit(1)

      if (data?.[0]) {
        await supabase
          .from('user_profiles')
          .update({ is_pro: false, plan: 'free' })
          .eq('user_id', data[0].user_id)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
