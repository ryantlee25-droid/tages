import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Hero } from '@/components/marketing/hero'
import { Quickstart } from '@/components/marketing/quickstart'
import { Search } from '@/components/marketing/search'
import { Memory } from '@/components/marketing/memory'
import { Teams } from '@/components/marketing/teams'
import { Pricing } from '@/components/marketing/pricing'
import { Close } from '@/components/marketing/close'
import { Rule } from '@/components/marketing/ui'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <>
      <Hero />
      <Search />
      <div className="px-6"><div className="mx-auto max-w-5xl"><Rule /></div></div>
      <Quickstart />
      <div className="px-6"><div className="mx-auto max-w-5xl"><Rule /></div></div>
      <Memory />
      <div className="px-6"><div className="mx-auto max-w-5xl"><Rule /></div></div>
      <Teams />
      <div className="px-6"><div className="mx-auto max-w-5xl"><Rule /></div></div>
      <Pricing />
      <Close />
    </>
  )
}
