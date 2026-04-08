import Image from 'next/image'
import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative flex flex-col items-center px-6 pt-32 pb-20 text-center">
      <Image
        src="/logo-hero.png"
        alt="Tages"
        width={480}
        height={320}
        className="mb-8 h-40 w-auto sm:h-52"
        style={{ filter: 'hue-rotate(-13deg) saturate(0.6)' }}
        priority
      />
      <div className="mb-6 inline-flex items-center rounded-full border border-[#3BA3C7]/30 bg-[#3BA3C7]/10 px-4 py-1.5 text-sm text-[#3BA3C7]">
        One command to install. Works offline. Syncs when connected.
      </div>

      <h1 className="max-w-3xl text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
        Memory isn&apos;t storage.{' '}
        <span style={{ color: '#3BA3C7' }}>It&apos;s a team practice.</span>
      </h1>
      <p className="mt-6 max-w-xl text-lg text-zinc-400">
        When three developers use AI agents on the same codebase, those agents need to share
        what they know. Tages gives them persistent, quality-controlled, shared memory:
        conventions, decisions, architecture, past mistakes.
      </p>

      <div className="mt-10 flex gap-4">
        <Link
          href="/examples"
          className="rounded-lg px-8 py-3.5 text-sm font-medium text-white transition-all hover:opacity-90 hover:shadow-lg hover:shadow-[#3BA3C7]/20"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          See how teams use it
        </Link>
        <Link
          href="/auth/login"
          className="rounded-lg border border-zinc-700 px-8 py-3.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Try the demo
        </Link>
      </div>

      {/* Stats */}
      <div className="mt-12 flex gap-8 text-center">
        <div>
          <p className="text-2xl font-bold text-white">20</p>
          <p className="text-xs text-zinc-500">free MCP tools</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">&lt;10ms</p>
          <p className="text-xs text-zinc-500">local recall</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">+6.3</p>
          <p className="text-xs text-zinc-500">quality delta (complex tasks)</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-white">Any</p>
          <p className="text-xs text-zinc-500">model or machine</p>
        </div>
      </div>

      {/* Code snippet */}
      <div className="mt-16 w-full max-w-lg overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3">
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <div className="h-3 w-3 rounded-full bg-zinc-700" />
          <span className="ml-3 text-xs text-zinc-500">Terminal</span>
        </div>
        <div className="space-y-2 p-4 font-mono text-sm">
          <p className="text-zinc-500"># Add to any MCP client (Claude, Qwen, DeepSeek)</p>
          <p>
            <span className="text-zinc-500">$</span>{' '}
            <span className="text-green-400">claude mcp add tages</span>{' '}
            <span className="text-zinc-300">-- npx -y @tages/server</span>
          </p>
          <p className="text-zinc-500 mt-1">MCP server registered.</p>
          <p className="mt-4">
            <span className="text-zinc-500"># Agent remembers conventions across sessions</span>
          </p>
          <p>
            <span className="text-zinc-500">$</span>{' '}
            <span className="text-green-400">tages recall</span>{' '}
            <span className="text-zinc-300">&quot;error handling&quot;</span>
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
