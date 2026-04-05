import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/app/projects')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
        Tages
      </h1>
      <p className="mt-4 max-w-md text-center text-lg text-zinc-400">
        Your agents remember everything. Your codebase never gets re-explained.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href="/auth/login"
          className="rounded-lg bg-white px-6 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100"
        >
          Get started free
        </Link>
        <a
          href="https://github.com/ryantlee25-droid/tages"
          className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          View on GitHub
        </a>
      </div>
    </div>
  )
}
