import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Hero } from '@/components/marketing/hero'
import { Problem } from '@/components/marketing/problem'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { ValueProps } from '@/components/marketing/value-props'
import { Footer } from '@/components/marketing/footer'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <ValueProps />
      <Footer />
    </>
  )
}
