import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ExamplesPage } from '@/components/marketing/examples-page'
import { Footer } from '@/components/marketing/footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Examples — Tages',
  description: 'See real examples of what AI agents remember with Tages. Conventions, decisions, architecture, anti-patterns — the context that prevents mistakes.',
}

export default async function Examples() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <>
      <ExamplesPage />
      <Footer />
    </>
  )
}
