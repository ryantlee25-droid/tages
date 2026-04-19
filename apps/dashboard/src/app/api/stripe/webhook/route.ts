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

function planFromPriceId(priceId: string): 'pro' | 'team' | null {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro'
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return 'team'
  return null
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  const stripe = getStripe()
  let event: ReturnType<typeof stripe.webhooks.constructEvent>

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
      const session = event.data.object as {
        metadata?: Record<string, string>
        customer?: string | null
        subscription?: string | null
      }
      const userId = session.metadata?.user_id

      if (!userId) {
        console.error('[webhook] checkout.session.completed: missing user_id in metadata')
        return NextResponse.json({ received: true })
      }

      const customerId = session.customer as string | undefined
      const subscriptionId = session.subscription as string | undefined

      if (!subscriptionId) {
        console.error('[webhook] checkout.session.completed: missing subscription id')
        return NextResponse.json({ received: true })
      }

      // Retrieve full subscription to get price ID and quantity
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      const item = subscription.items.data[0]
      const priceId = item?.price?.id
      const plan = (priceId ? planFromPriceId(priceId) : null) ?? (session.metadata?.plan as 'pro' | 'team' | undefined) ?? 'pro'
      const quantity = item?.quantity ?? 1

      await supabase.from('user_profiles').upsert({
        user_id: userId,
        is_pro: true,
        plan,
        pro_since: new Date().toISOString(),
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        subscription_quantity: quantity,
        subscription_status: subscription.status,
      })

      // Propagate plan to all projects owned by this user
      await supabase
        .from('projects')
        .update({ plan })
        .eq('owner_id', userId)

      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as {
        customer?: string | null
        id: string
        status: string
        metadata?: Record<string, string>
        items: { data: Array<{ price: { id: string }; quantity?: number | null }> }
      }
      const customerId = subscription.customer as string | undefined

      // Primary lookup: customer_id (written by checkout.session.completed).
      // Fallback: metadata.user_id on the subscription (set at checkout creation).
      // This handles the race where 'updated' arrives before 'completed' persists the customer_id.
      let userId: string | undefined
      if (customerId) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .limit(1)
        userId = profiles?.[0]?.user_id
      }
      if (!userId && subscription.metadata?.user_id) {
        userId = subscription.metadata.user_id
      }

      if (!userId) {
        console.error('[webhook] customer.subscription.updated: no user found', { customerId, metadata: subscription.metadata })
        return NextResponse.json({ received: true })
      }

      const item = subscription.items.data[0]
      const priceId = item?.price?.id
      const plan: 'pro' | 'team' | 'free' = (priceId ? planFromPriceId(priceId) : null) ?? 'free'
      const quantity = item?.quantity ?? 1

      await supabase
        .from('user_profiles')
        .update({
          plan,
          subscription_quantity: quantity,
          subscription_status: subscription.status,
          stripe_subscription_id: subscription.id,
        })
        .eq('user_id', userId)

      // Propagate plan to all projects owned by this user
      await supabase
        .from('projects')
        .update({ plan })
        .eq('owner_id', userId)

      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as {
        customer?: string | null
        id: string
      }
      const customerId = subscription.customer as string | undefined

      if (!customerId) {
        console.error('[webhook] customer.subscription.deleted: missing customer id')
        return NextResponse.json({ received: true })
      }

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .limit(1)

      const userId = profiles?.[0]?.user_id
      if (!userId) {
        console.error('[webhook] customer.subscription.deleted: no user found for customer', customerId)
        return NextResponse.json({ received: true })
      }

      await supabase
        .from('user_profiles')
        .update({
          is_pro: false,
          plan: 'free',
          stripe_subscription_id: null,
          subscription_quantity: null,
          subscription_status: 'canceled',
        })
        .eq('user_id', userId)

      // Reset all owned projects to free
      await supabase
        .from('projects')
        .update({ plan: 'free' })
        .eq('owner_id', userId)

      break
    }
  }

  return NextResponse.json({ received: true })
}
