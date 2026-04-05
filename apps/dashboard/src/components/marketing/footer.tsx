import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 px-6 py-12">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: '#3BA3C7' }}>Tages</span>
          <span className="text-xs text-zinc-500">Persistent memory for AI agents</span>
        </div>
        <div className="flex gap-6 text-sm text-zinc-400">
          <Link href="/auth/login" className="hover:text-white">Try demo</Link>
          <a href="mailto:support@tages.dev" className="hover:text-white">Contact</a>
        </div>
      </div>
    </footer>
  )
}
