import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Hero } from '@/components/marketing/hero'
import { Problem } from '@/components/marketing/problem'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { Footer } from '@/components/marketing/footer'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Subtle grid texture */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative">
        <Hero />
        <Problem />
        <HowItWorks />
        <Footer />
      </div>
    </div>
  )
}
