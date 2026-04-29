'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

export function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-zinc-800/50 bg-[#0a0a0a]/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-2 sm:py-4 -my-3">
        <Link href="/" className="flex items-center gap-1">
          <Image
            src="/logo-hero.png"
            alt="Tages"
            width={240}
            height={160}
            className="h-12 sm:h-20 lg:h-28 w-auto"
            style={{ filter: 'hue-rotate(-13deg) saturate(0.6)' }}
            priority
          />
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-6 sm:flex">
          <Link href="/examples" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Examples
          </Link>
          <Link href="/pricing" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Pricing
          </Link>
          <Link href="/security" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Security
          </Link>
          <Link href="/governance" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Governance
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
            Get started
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(!open)}
          className="sm:hidden p-2 text-zinc-400 hover:text-white"
          aria-label="Toggle menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-zinc-800/50 px-6 py-4 sm:hidden">
          <div className="flex flex-col gap-4">
            <Link href="/examples" onClick={() => setOpen(false)} className="text-sm text-zinc-400 hover:text-white">
              Examples
            </Link>
            <Link href="/pricing" onClick={() => setOpen(false)} className="text-sm text-zinc-400 hover:text-white">
              Pricing
            </Link>
            <Link href="/security" onClick={() => setOpen(false)} className="text-sm text-zinc-400 hover:text-white">
              Security
            </Link>
            <Link href="/governance" onClick={() => setOpen(false)} className="text-sm text-zinc-400 hover:text-white">
              Governance
            </Link>
            <a
              href="https://github.com/ryantlee25-droid/tages"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-zinc-400 hover:text-white"
            >
              GitHub
            </a>
            <Link
              href="/auth/login"
              onClick={() => setOpen(false)}
              className="inline-flex w-fit rounded-lg px-4 py-1.5 text-sm font-medium text-white"
              style={{ backgroundColor: '#3BA3C7' }}
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
