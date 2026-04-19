import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Pricing, PricingComparison, PricingFAQ } from '@/components/marketing/pricing'
import { Footer } from '@/components/marketing/footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing | Tages',
  description: 'Simple pricing for AI coding agent memory. Free for solo devs, $14/mo for pros, $19/seat for teams. Self-hosted is free forever.',
}

export default async function PricingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <>
      <div className="pt-16" />
      <Pricing />
      <PricingComparison />
      <PricingFAQ />
      <Footer />
    </>
  )
}
