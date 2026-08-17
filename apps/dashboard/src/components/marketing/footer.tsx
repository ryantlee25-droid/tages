import Link from 'next/link'

const GROUPS = [
  {
    title: 'Product',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/examples', label: 'Examples' },
      { href: '/auth/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/security', label: 'Security' },
      { href: '/governance', label: 'Governance' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
  {
    title: 'Developers',
    links: [
      {
        href: 'https://github.com/ryantlee25-droid/tages/blob/main/docs/quickstart.md',
        label: 'Quickstart',
        external: true,
      },
      {
        href: 'https://github.com/ryantlee25-droid/tages/blob/main/docs/team-onboarding.md',
        label: 'Team onboarding',
        external: true,
      },
      { href: 'https://www.npmjs.com/package/@tages/cli', label: 'npm', external: true },
      { href: 'https://github.com/ryantlee25-droid/tages', label: 'GitHub', external: true },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line/70 px-6 py-14">
      <div className="mx-auto w-full max-w-5xl">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Tages</p>
            <p className="measure mt-2 text-label text-ink-muted">
              Shared memory for AI coding agents. Named for the Etruscan divine child who
              dictated sacred knowledge to scribes.
            </p>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title}>
              <h2 className="text-label font-medium text-ink">{g.title}</h2>
              <ul className="mt-3 space-y-2">
                {g.links.map((l) => (
                  <li key={l.href}>
                    {'external' in l && l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-label text-ink-muted transition-colors duration-150 hover:text-ink"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <Link
                        href={l.href}
                        className="text-label text-ink-muted transition-colors duration-150 hover:text-ink"
                      >
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-label text-ink-muted">
            © {new Date().getFullYear()} Tages. MIT licensed.
          </p>
          <p className="text-label text-ink-muted">
            <a
              href="mailto:support@tages.ai"
              className="transition-colors duration-150 hover:text-ink-soft"
            >
              support@tages.ai
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
