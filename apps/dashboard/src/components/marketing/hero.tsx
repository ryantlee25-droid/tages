import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative flex flex-col items-center px-6 pt-32 pb-20 text-center">
      <h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
        Your agents remember everything.{' '}
        <span style={{ color: '#3BA3C7' }}>Your codebase never gets re-explained.</span>
      </h1>
      <p className="mt-6 max-w-xl text-lg text-zinc-400">
        Tages gives AI coding agents persistent, cross-session memory about your codebase.
        Architectural decisions, naming conventions, past mistakes — remembered automatically.
      </p>

      <div className="mt-10 flex gap-4">
        <Link
          href="/auth/login"
          className="rounded-lg px-6 py-3 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          Get started free
        </Link>
        <a
          href="https://github.com/ryantlee25-droid/tages"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          View on GitHub
        </a>
      </div>

      {/* Animated code snippet */}
      <div className="mt-16 w-full max-w-lg overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <span className="ml-3 text-xs text-zinc-500">Terminal</span>
        </div>
        <div className="space-y-2 p-4 font-mono text-sm">
          <p>
            <span className="text-zinc-500">$</span>{' '}
            <span className="text-green-400">tages remember</span>{' '}
            <span className="text-zinc-300">&quot;api-errors&quot; &quot;Return &#123; error, code, status &#125;&quot;</span>{' '}
            <span className="text-zinc-500">--type convention</span>
          </p>
          <p className="text-zinc-500">Stored: &quot;api-errors&quot; (convention)</p>
          <p className="mt-4">
            <span className="text-zinc-500">$ # ... 3 weeks later, new session ...</span>
          </p>
          <p>
            <span className="text-zinc-500">$</span>{' '}
            <span className="text-green-400">tages recall</span>{' '}
            <span className="text-zinc-300">&quot;error handling&quot;</span>
          </p>
          <p className="text-zinc-500">
            Found 1 memory:
          </p>
          <p>
            <span className="text-blue-400">[convention]</span>{' '}
            <span className="text-white">api-errors</span>
          </p>
          <p className="text-zinc-400 pl-4">Return &#123; error, code, status &#125;</p>
        </div>
      </div>
    </section>
  )
}
