export function Footer() {
  return (
    <footer className="border-t border-zinc-800 px-6 py-12">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: '#3BA3C7' }}>Tages</span>
          <span className="text-xs text-zinc-500">Persistent memory for AI agents</span>
        </div>
        <div className="flex gap-6 text-sm text-zinc-400">
          <a
            href="https://github.com/ryantlee25-droid/tages"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white"
          >
            GitHub
          </a>
          <a href="/docs" className="hover:text-white">Docs</a>
          <a href="mailto:support@tages.dev" className="hover:text-white">Support</a>
        </div>
      </div>
    </footer>
  )
}
