'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'

/* ---------------------------------------------------------------- Button */

type ButtonProps = {
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost'
  external?: boolean
  className?: string
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-control px-4 h-10 text-sm font-medium ' +
  'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600'

const buttonVariants = {
  /* No coloured shadow. A blue halo under a blue slab darkens its edge and makes the
   * button read heavier than the same blue does as text, which is the whole reason the
   * fill looked darker than the rest of the palette. The hairline neutral shadow stays
   * so the control still sits above the page. */
  primary:
    'bg-signal-600 text-white font-semibold hover:bg-signal-700 ' +
    'shadow-[0_1px_1px_rgba(15,23,32,0.04)]',
  secondary:
    'border border-line-strong bg-paper text-ink hover:bg-paper-sunken',
  ghost: 'text-ink-soft hover:text-ink',
} as const

export function Button({ href, children, variant = 'primary', external, className = '' }: ButtonProps) {
  const cls = `${buttonBase} ${buttonVariants[variant]} ${className}`
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}

/* --------------------------------------------------------- Command field */

/**
 * The install line is the page's primary proof, so it behaves like a real
 * control: a single click copies it and the button reports what happened.
 * `navigator.clipboard` is unavailable on insecure origins, so the failure
 * path selects the text instead of silently doing nothing.
 */
export function Command({ value, label = 'Copy command' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2000)
  }, [value])

  return (
    <div className="group flex w-full items-center gap-3 rounded-control border border-line bg-paper-raised pl-4 pr-1.5 py-1.5 font-mono text-sm">
      <span aria-hidden className="select-none text-ink-faint">$</span>
      {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, so without it
       *  this nowrap line refuses to shrink and pushes the whole page wider than a phone. */}
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-ink">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className="shrink-0 rounded-[0.375rem] px-2.5 h-7 text-xs font-sans font-medium text-ink-soft transition-colors duration-150 hover:bg-paper-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-600"
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------- Structure */

export function Section({
  children,
  className = '',
  id,
  tight,
}: {
  children: React.ReactNode
  className?: string
  id?: string
  /** Halves the top padding. For a section sitting directly under the hero,
   *  where the hero's own bottom padding already supplies the separation.
   *  A prop rather than an `!important` override, so reordering the page
   *  cannot silently leave the wrong spacing behind. */
  tight?: boolean
}) {
  return (
    <section
      id={id}
      className={`px-6 pb-14 sm:pb-20 ${tight ? 'pt-8 sm:pt-10' : 'pt-14 sm:pt-20'} ${className}`}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  )
}

export function Rule({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`rule-x h-px w-full ${className}`} />
}

export function SectionHead({
  title,
  lead,
  className = '',
}: {
  title: string
  lead?: string
  className?: string
}) {
  return (
    <div className={className}>
      <h2 className="max-w-[26ch] text-title text-balance text-ink">{title}</h2>
      {lead ? <p className="mt-4 measure text-lead text-ink-soft">{lead}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------ Code panel */

export function CodePanel({
  filename,
  lines,
}: {
  filename?: string
  lines: Array<{ text: string; tone?: 'default' | 'muted' | 'accent' | 'positive' }>
}) {
  const tones = {
    default: 'text-ink',
    muted: 'text-ink-muted',
    accent: 'text-signal-600',
    positive: 'text-[color:var(--color-positive)]',
  } as const

  return (
    /* min-w-0 so the panel can sit in a grid or flex track and still scroll its own
     * long lines instead of widening the page. */
    <div className="min-w-0 overflow-hidden rounded-card border border-line bg-paper-sunken">
      {filename ? (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-mono text-xs text-ink-muted">{filename}</span>
        </div>
      ) : null}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7]">
        <code>
          {lines.map((line, i) => (
            <div key={i} className={tones[line.tone ?? 'default']}>
              {line.text || ' '}
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}
