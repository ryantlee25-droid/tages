import Image from 'next/image'
import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 px-6 py-12">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src="/logo-hero.png" alt="Tages" width={300} height={200} className="h-16 w-auto" style={{ filter: 'hue-rotate(-13deg) saturate(0.6)' }} />
          <span className="text-xs text-zinc-500">Persistent memory for AI agents</span>
        </div>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-zinc-400">
          <Link href="/examples" className="hover:text-white transition-colors">Examples</Link>
          <Link href="/security" className="hover:text-white transition-colors">Security</Link>
          <a
            href="https://github.com/ryantlee25-droid/tages"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://github.com/ryantlee25-droid/tages/blob/main/docs/quickstart.md"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            Docs
          </a>
          <Link href="/auth/login" className="hover:text-white transition-colors">Try demo</Link>
        </div>
      </div>
    </footer>
  )
}
