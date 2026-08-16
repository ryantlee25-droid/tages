'use client'

import Image from 'next/image'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '/examples', label: 'Examples' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
  { href: '/governance', label: 'Governance' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // The bar is transparent over the hero and gains its hairline only once
  // content passes beneath it, so the first viewport reads as one surface.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 z-50 w-full transition-colors duration-200 ${
        scrolled || open
          ? // Opaque, not translucent. On a white ground a semi-transparent bar
            // lets scrolling text ghost through it, which reads as a rendering
            // fault rather than as depth; the hairline alone carries the layer.
            'border-b border-line bg-paper'
          : 'border-b border-transparent'
      }`}
    >
      <div className="px-6">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between">
        <Link
          href="/"
          className="flex items-center rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-600"
        >
          {/* The asset is pre-filled with the accent token (#2563eb), so the
              one branded element on the page cannot drift off-palette. It was
              briefly a CSS mask for the same reason, but a mask fails to a
              solid colour block if the image 404s and disappears entirely
              under forced-colors. */}
          <Image
            src="/logo-wordmark-accent.png"
            alt="Tages"
            width={322}
            height={172}
            className="h-9 w-auto sm:h-10"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-label text-ink-soft transition-colors duration-150 hover:text-ink"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <a
            href="https://github.com/ryantlee25-droid/tages"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-muted transition-colors duration-150 hover:text-ink"
            aria-label="Tages on GitHub"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-[18px] w-[18px]">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
          <Link
            href="/auth/login"
            className="inline-flex h-8 items-center rounded-control border border-line bg-paper-raised px-3.5 text-label font-medium text-ink transition-colors duration-150 hover:border-line-strong hover:bg-paper-sunken"
          >
            Sign in
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="-mr-2 inline-flex h-10 w-10 items-center justify-center rounded-control text-ink-soft transition-colors hover:text-ink md:hidden"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-5 w-5">
            {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 13h14" />}
          </svg>
        </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" className="border-t border-line/70 px-6 py-4 md:hidden" aria-label="Main">
          <ul className="space-y-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-control px-2 py-2.5 text-ink hover:bg-paper-sunken hover:text-ink"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="pt-2">
              <Link
                href="/auth/login"
                onClick={() => setOpen(false)}
                className="block rounded-control bg-signal-600 px-3 py-2.5 text-center font-semibold text-white"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  )
}
