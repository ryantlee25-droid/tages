import Link from 'next/link'

export function Nav() {
  return (
    <nav className="fixed top-0 z-50 w-full border-b border-zinc-800/50 bg-[#0a0a0a]/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-bold" style={{ color: '#3BA3C7' }}>
          Tages
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/examples" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Examples
          </Link>
          <Link href="/security" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Security
          </Link>
          <a
            href="https://github.com/ryantlee25-droid/tages"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            GitHub
          </a>
          <Link
            href="/auth/login"
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ backgroundColor: '#3BA3C7' }}
          >
            Try demo
          </Link>
        </div>
      </div>
    </nav>
  )
}
