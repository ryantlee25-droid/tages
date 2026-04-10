import Link from 'next/link'

interface SecuritySectionProps {
  title: string
  children: React.ReactNode
}

function SecuritySection({ title, children }: SecuritySectionProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      <div className="space-y-3 text-zinc-400">{children}</div>
    </div>
  )
}

interface SecurityBadgeProps {
  label: string
}

function SecurityBadge({ label }: SecurityBadgeProps) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#3BA3C7]/30 bg-[#3BA3C7]/10 px-3 py-0.5 text-xs font-medium text-[#3BA3C7]">
      {label}
    </span>
  )
}

export function SecurityPage() {
  return (
    <div className="relative mx-auto max-w-3xl px-6 py-24">
      {/* Header */}
      <div className="mb-16 text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-[#3BA3C7]/30 bg-[#3BA3C7]/10 px-4 py-1.5 text-sm text-[#3BA3C7]">
          Security posture
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Built with security{' '}
          <span style={{ color: '#3BA3C7' }}>from the start</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-400">
          Tages is open-source and self-hostable. We document our security posture
          openly so you can evaluate it for your team.
        </p>
      </div>

      {/* Badges */}
      <div className="mb-12 flex flex-wrap justify-center gap-2">
        <SecurityBadge label="AES-256-GCM encryption" />
        <SecurityBadge label="TLS 1.2+" />
        <SecurityBadge label="Supabase Auth" />
        <SecurityBadge label="RLS on all tables" />
        <SecurityBadge label="RBAC" />
        <SecurityBadge label="Open source" />
      </div>

      {/* Sections */}
      <div className="space-y-6">
        <SecuritySection title="Encryption at rest">
          <p>
            Tages supports optional AES-256-GCM field-level encryption for memory values stored
            in Supabase. When enabled, memory content is encrypted before it ever reaches the
            database. Only your application can decrypt it.
          </p>
          <p>
            To enable encryption, set the <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs sm:text-sm font-mono text-zinc-200">TAGES_ENCRYPTION_KEY</code> environment
            variable to a 32-byte hex key. Without this variable, data is stored in plaintext
            (protected by Supabase RLS policies and your database credentials).
          </p>
          <p className="text-sm text-zinc-500">
            Encryption is opt-in by design. Self-hosted users choose their own key management strategy.
          </p>
        </SecuritySection>

        <SecuritySection title="Encryption in transit">
          <p>
            All connections to the Tages cloud dashboard and Supabase backend use TLS 1.2 or higher.
            HTTP Strict Transport Security (HSTS) is enforced on the dashboard to prevent protocol
            downgrade attacks.
          </p>
          <p>
            The MCP server and CLI communicate with Supabase over TLS. Local SQLite cache reads
            remain on-device and never leave your machine.
          </p>
        </SecuritySection>

        <SecuritySection title="Authentication">
          <p>
            The dashboard uses Supabase Auth with GitHub OAuth. Sessions are managed with
            SameSite=Strict cookies to prevent cross-site request forgery.
          </p>
          <p>
            CLI tokens are hashed with SHA-256 before storage. Raw tokens are never persisted.
            Tokens support configurable expiry and can be rotated at any time with:
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-xs sm:text-sm text-zinc-300">
            tages token rotate --expires-in 30
          </div>
          <p>
            Auth events (login success/failure, token validation) are written to an audit log for
            accountability and incident response.
          </p>
        </SecuritySection>

        <SecuritySection title="Data flow and LLM privacy">
          <p>
            <strong className="font-semibold text-white">Your memory data is never used to train LLMs.</strong>{' '}
            Tages does not send your codebase memories to any external model unless you explicitly
            invoke a recall or auto-index operation.
          </p>
          <p>
            Auto-indexing uses Ollama (local, no network calls) by default, with Claude Haiku as
            an optional fallback for users who opt in. Data sent to Haiku is governed by
            Anthropic&apos;s API terms, which prohibit training on API inputs.
          </p>
          <p>
            When you self-host, all data stays in your own Supabase project. Tages never has
            access to it.
          </p>
        </SecuritySection>

        <SecuritySection title="Access control">
          <p>
            Every table in the Tages schema has Row-Level Security (RLS) enabled with per-user
            and per-project policies. Users can only read and write their own data. This is
            enforced at the database layer, not just in application code.
          </p>
          <p>
            Projects support role-based access control with three roles:
          </p>
          <ul className="ml-4 list-disc space-y-1 text-zinc-400">
            <li><strong className="text-zinc-200">Owner</strong>: full control, can manage members and delete the project</li>
            <li><strong className="text-zinc-200">Admin</strong>: can read and write memories, manage most settings</li>
            <li><strong className="text-zinc-200">Member</strong>: read-only access to project memories</li>
          </ul>
        </SecuritySection>

        <SecuritySection title="Self-hosting">
          <p>
            Tages is fully open-source (MIT). You can run the entire stack on your own
            infrastructure with your own Supabase project. Bring your own keys, your own
            OAuth app, and your own encryption key.
          </p>
          <p>
            When self-hosting, the cloud dashboard at tages.ai is never involved. Your agents
            connect directly to your Supabase instance. This is the highest-isolation option
            for teams with strict data residency requirements.
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-xs sm:text-sm text-zinc-300">
            npm install -g @tages/cli{'\n'}tages init --supabase-url YOUR_URL --supabase-key YOUR_KEY
          </div>
        </SecuritySection>

        <SecuritySection title="Responsible disclosure">
          <p>
            We take security reports seriously. If you discover a vulnerability, please report
            it privately. Do not open a public GitHub issue.
          </p>
          <div className="mt-2 space-y-2 text-sm">
            <p>
              <strong className="text-zinc-200">Email:</strong>{' '}
              <a href="mailto:security@tages.ai" className="text-[#3BA3C7] hover:underline">
                security@tages.ai
              </a>
            </p>
            <p>
              <strong className="text-zinc-200">GitHub Security Advisory:</strong>{' '}
              <a
                href="https://github.com/ryantlee25-droid/tages/security/advisories/new"
                className="text-[#3BA3C7] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Submit a private report
              </a>
            </p>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            We acknowledge reports within 48 hours and aim to patch critical issues within
            7 days. Full disclosure policy in{' '}
            <Link
              href="https://github.com/ryantlee25-droid/tages/blob/main/SECURITY.md"
              className="text-[#3BA3C7] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              SECURITY.md
            </Link>
            .
          </p>
        </SecuritySection>
      </div>

      {/* Footer CTA */}
      <div className="mt-16 rounded-xl border border-[#3BA3C7]/20 bg-[#3BA3C7]/5 p-8 text-center">
        <h2 className="text-xl font-semibold text-white">Questions about our security posture?</h2>
        <p className="mt-2 text-zinc-400">
          We&apos;re happy to answer questions from security teams evaluating Tages.
        </p>
        <a
          href="mailto:security@tages.ai"
          className="mt-6 inline-flex items-center rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          Contact security@tages.ai
        </a>
      </div>
    </div>
  )
}
