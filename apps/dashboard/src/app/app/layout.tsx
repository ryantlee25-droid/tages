import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check Pro status
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_pro')
    .eq('user_id', user.id)
    .single()

  const isPro = profile?.is_pro ?? false

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col border-r border-zinc-800 bg-zinc-950 md:flex">
        <div className="p-4">
          <Link href="/app/projects" className="flex items-center gap-2">
            <span className="text-lg font-bold" style={{ color: '#3BA3C7' }}>Tages</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-2">
          <NavLink href="/app/projects">Projects</NavLink>
        </nav>

        <div className="border-t border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs text-zinc-300">
              {user.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs text-zinc-300">{user.email}</p>
                {isPro && (
                  <span className="shrink-0 rounded bg-[#3BA3C7]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#3BA3C7]">
                    PRO
                  </span>
                )}
              </div>
            </div>
          </div>
          {!isPro && (
            <Link
              href="/app/upgrade"
              className="mt-2 block w-full rounded-md py-1.5 text-center text-xs font-medium text-[#3BA3C7] transition-colors hover:bg-[#3BA3C7]/10"
            >
              Upgrade to Pro
            </Link>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="mt-2 w-full text-left text-xs text-zinc-500 hover:text-zinc-300"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-800 bg-zinc-950 md:hidden">
        <MobileNavLink href="/app/projects">Projects</MobileNavLink>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        {children}
      </main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
    >
      {children}
    </Link>
  )
}

function MobileNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col items-center justify-center py-3 text-xs text-zinc-400 hover:text-white"
    >
      {children}
    </Link>
  )
}
