import type { Metadata } from 'next'
import { Footer } from '@/components/marketing/footer'

export const metadata: Metadata = {
  title: 'Privacy Policy | Tages',
  description:
    'Tages privacy policy. We store your codebase memories on your behalf. We do not train AI models on your data. We do not sell your data.',
}

export default function PrivacyPage() {
  return (
    <>
      <article className="mx-auto max-w-3xl px-6 py-20 prose prose-invert">
        <h1 className="text-4xl font-bold text-white">Privacy Policy</h1>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Effective date:</strong> April 10, 2026
          {' · '}
          <strong className="text-zinc-300">Last updated:</strong> April 10, 2026
        </p>

        <p className="mt-6 text-zinc-300">
          Tages is an open-source tool that gives AI coding agents persistent memory about your
          codebase. This policy explains exactly what data Tages collects, where it goes, and what
          we do with it.
        </p>
        <p className="text-zinc-300">
          The short version:{' '}
          <strong>
            we store your memories on your behalf. We do not train AI models on your data. We do
            not sell your data. In local-only mode, nothing leaves your machine.
          </strong>
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">1. Two Modes, Two Data Stories</h2>
        <p className="text-zinc-400">
          Tages operates in two modes. Which one you choose determines what data leaves your
          machine.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-zinc-400">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="pb-2 pr-6 text-left text-zinc-500 font-medium" />
                <th className="pb-2 px-4 text-left text-zinc-300 font-semibold">Local-Only Mode</th>
                <th className="pb-2 px-4 text-left text-zinc-300 font-semibold">Cloud Mode</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Activated by', 'tages init --local', 'tages init (default)'],
                ['Storage', 'SQLite on your machine', 'SQLite cache + Supabase Postgres (US)'],
                ['Authentication', 'None required', 'GitHub OAuth via Supabase'],
                ['Data sent to cloud', 'Nothing', 'Memories, project metadata, auth profile'],
                ['Account required', 'No', 'Yes (GitHub)'],
              ].map(([label, local, cloud]) => (
                <tr key={label} className="border-b border-zinc-800/50">
                  <td className="py-2 pr-6 text-zinc-500 font-medium">{label}</td>
                  <td className="py-2 px-4">{local}</td>
                  <td className="py-2 px-4">{cloud}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-zinc-400">
          If you use local-only mode, the rest of this policy largely does not apply to you. Your
          data stays on your filesystem. We have no access to it.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">2. Data We Collect</h2>

        <h3 className="text-lg font-semibold text-zinc-200">All users (local and cloud)</h3>
        <p className="text-zinc-400">
          <strong>Nothing by default.</strong> Tages does not phone home, send telemetry, or
          collect analytics unless you opt in.
        </p>

        <h3 className="text-lg font-semibold text-zinc-200">Cloud mode only</h3>
        <p className="text-zinc-400">
          When you authenticate and sync to the cloud, we store:
        </p>
        <ul className="space-y-1 text-zinc-400">
          <li>
            <strong className="text-zinc-300">Codebase memories</strong> — key/value pairs you
            create via <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">remember</code>,
            with category, context string, and timestamps
          </li>
          <li>
            <strong className="text-zinc-300">Project metadata</strong> — project name, project
            UUID, creation date
          </li>
          <li>
            <strong className="text-zinc-300">Authentication profile</strong> — GitHub username,
            email address, and avatar URL (received from GitHub OAuth). We do not request access
            to your repositories.
          </li>
          <li>
            <strong className="text-zinc-300">Usage metadata</strong> — memory counts, tool
            invocation counts, sync timestamps
          </li>
          <li>
            <strong className="text-zinc-300">Auth tokens</strong> — stored as SHA-256 hashes
            only. We never store plaintext tokens.
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-zinc-200">What we do NOT collect</h3>
        <ul className="space-y-1 text-zinc-400">
          <li>Your source code</li>
          <li>Your repository contents</li>
          <li>Your file system structure</li>
          <li>Your IDE or editor activity</li>
          <li>Telemetry or analytics (unless you explicitly opt in)</li>
        </ul>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">3. How Data Is Stored</h2>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Local storage:</strong> SQLite database in{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">.tages/</code>{' '}
          within your project directory. You control this file entirely — delete it anytime.
        </p>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Cloud storage:</strong> Supabase Postgres hosted in
          the United States (AWS us-east-1). Supabase encrypts data at rest and in transit.
        </p>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Optional encryption:</strong> Set{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">TAGES_ENCRYPTION_KEY</code>{' '}
          to enable AES-256-GCM field-level encryption on memory values before they leave your
          machine. When enabled, we cannot read your memory contents on the server.
        </p>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Row-level security:</strong> Every Supabase table has
          RLS policies. Users can only access their own data. Project members are scoped by RBAC
          role (owner, admin, member).
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">4. Your Code and Intellectual Property</h2>
        <p className="text-zinc-400">
          <strong>We do not train AI models on your data.</strong> Not now, not in the future, not
          with anonymization, not with aggregation. Your memories are yours.
        </p>
        <p className="text-zinc-400">
          <strong>You retain all intellectual property</strong> in the memories you store. Tages
          acts as a <strong>data processor</strong> — we store data on your behalf and return it
          when you ask. We are not a data controller over your codebase context.
        </p>
        <p className="text-zinc-400">
          <strong>We do not access your memories</strong> except to provide the service (storage,
          sync, search). No Tages employee will read your memory contents unless you explicitly
          share them with us for debugging purposes.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">5. Third-Party Services</h2>
        <p className="text-zinc-400">Tages uses two third-party services in cloud mode:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-zinc-400">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="pb-2 pr-6 text-left text-zinc-300 font-semibold">Service</th>
                <th className="pb-2 px-4 text-left text-zinc-300 font-semibold">Purpose</th>
                <th className="pb-2 px-4 text-left text-zinc-300 font-semibold">Data shared</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-800/50">
                <td className="py-2 pr-6 font-medium text-zinc-300">Supabase</td>
                <td className="py-2 px-4">Authentication, database, storage</td>
                <td className="py-2 px-4">Auth profile, memories, project metadata</td>
              </tr>
              <tr className="border-b border-zinc-800/50">
                <td className="py-2 pr-6 font-medium text-zinc-300">GitHub</td>
                <td className="py-2 px-4">OAuth identity provider</td>
                <td className="py-2 px-4">OAuth token exchange only — we request <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">user:email</code> scope</td>
              </tr>
              <tr className="border-b border-zinc-800/50">
                <td className="py-2 pr-6 font-medium text-zinc-300">Stripe</td>
                <td className="py-2 px-4">Payment processing (paid plans)</td>
                <td className="py-2 px-4">Email address, payment method (handled by Stripe directly)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-zinc-400">
          We do not use any advertising services, analytics platforms, or data brokers.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">6. Data Retention and Deletion</h2>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Local data:</strong> Entirely under your control.
          Delete{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">.tages/</code>{' '}
          or run{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages forget</code>{' '}
          to remove memories.
        </p>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Cloud data:</strong>
        </p>
        <ul className="space-y-1 text-zinc-400">
          <li>
            Run{' '}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages forget --key &lt;key&gt;</code>{' '}
            to delete specific memories
          </li>
          <li>
            Run{' '}
            <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages forget --all</code>{' '}
            to delete all memories for a project
          </li>
          <li>Delete your account to remove all data associated with your user ID</li>
          <li>
            After deletion, data is removed from the active database immediately. Supabase database
            backups are retained for up to 7 days, after which deleted data is permanently gone.
          </li>
        </ul>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Auth tokens:</strong> Revocable via{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages token rotate</code>.
          Old token hashes are deleted on rotation.
        </p>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Account deletion:</strong> Email{' '}
          <a href="mailto:support@tages.ai" className="text-[#3BA3C7] hover:underline">
            support@tages.ai
          </a>{' '}
          to request full account deletion. We will process requests within 30 days.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">7. Your Rights</h2>
        <h3 className="text-lg font-semibold text-zinc-200">GDPR (EU/EEA/UK residents)</h3>
        <p className="text-zinc-400">You have the right to:</p>
        <ul className="space-y-1 text-zinc-400">
          <li><strong className="text-zinc-300">Access</strong> your personal data — export via <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages recall</code> or the dashboard</li>
          <li><strong className="text-zinc-300">Rectify</strong> inaccurate data — update memories via <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages remember</code></li>
          <li><strong className="text-zinc-300">Erase</strong> your data — <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages forget --all</code> or request account deletion</li>
          <li><strong className="text-zinc-300">Port</strong> your data — export via CLI or dashboard in JSON format</li>
          <li><strong className="text-zinc-300">Object</strong> to processing — switch to local-only mode or delete your account</li>
        </ul>
        <p className="text-zinc-400">
          To exercise these rights, email{' '}
          <a href="mailto:support@tages.ai" className="text-[#3BA3C7] hover:underline">
            support@tages.ai
          </a>. We respond within 30 days.
        </p>

        <h3 className="text-lg font-semibold text-zinc-200">CCPA (California residents)</h3>
        <p className="text-zinc-400">You have the right to:</p>
        <ul className="space-y-1 text-zinc-400">
          <li><strong className="text-zinc-300">Know</strong> what personal information we collect (this document)</li>
          <li><strong className="text-zinc-300">Delete</strong> your personal information (see Section 6)</li>
          <li><strong className="text-zinc-300">Opt out</strong> of the sale of personal information — we do not sell personal information, period</li>
        </ul>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">8. Open-Source Considerations</h2>
        <p className="text-zinc-400">
          Tages is MIT licensed. The source code is publicly auditable at{' '}
          <a
            href="https://github.com/ryantlee25-droid/tages"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3BA3C7] hover:underline"
          >
            github.com/ryantlee25-droid/tages
          </a>.
        </p>
        <p className="text-zinc-400">
          <strong>Local-only mode is a complete zero-data option.</strong> You can use Tages
          without creating an account, without connecting to the internet, and without sharing any
          data with us or anyone else.
        </p>
        <p className="text-zinc-400">
          <strong>No telemetry by default.</strong> We do not collect usage analytics, crash
          reports, or behavioral data unless you explicitly opt in to a future telemetry program
          (which does not currently exist).
        </p>
        <p className="text-zinc-400">
          <strong>Self-hosting:</strong> You can run the entire stack yourself (MCP server + CLI +
          Supabase instance). In that configuration, no data touches our infrastructure.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">9. Security</h2>
        <p className="text-zinc-400">We take security seriously. Highlights:</p>
        <ul className="space-y-1 text-zinc-400">
          <li>AES-256-GCM optional field-level encryption</li>
          <li>SHA-256 token hashing (no plaintext storage)</li>
          <li>Row-level security on all database tables</li>
          <li>RBAC with owner/admin/member roles</li>
          <li>HTTPS/TLS for all cloud communication</li>
          <li>Zod input validation on all 56 MCP tools</li>
          <li>Secret and PII detection before storage</li>
        </ul>
        <p className="text-zinc-400">
          For full details and responsible disclosure, see our{' '}
          <a href="/security" className="text-[#3BA3C7] hover:underline">
            Security page
          </a>.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">10. Children</h2>
        <p className="text-zinc-400">
          Tages is a developer tool. It is not directed at children under 13. We do not knowingly
          collect personal information from children. If you believe a child has provided us with
          personal data, contact us at{' '}
          <a href="mailto:support@tages.ai" className="text-[#3BA3C7] hover:underline">
            support@tages.ai
          </a>{' '}
          and we will delete it.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">11. Changes to This Policy</h2>
        <p className="text-zinc-400">
          We will update this policy as Tages evolves. For material changes (new data collection,
          new third parties, changes to IP commitments), we will:
        </p>
        <ul className="space-y-1 text-zinc-400">
          <li>Update this document with a new &quot;Last updated&quot; date</li>
          <li>Note the change in the repository changelog</li>
          <li>Provide at least 30 days notice before material changes take effect</li>
        </ul>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">12. Contact</h2>
        <p className="text-zinc-400">
          For privacy questions, data requests, or account deletion:
        </p>
        <ul className="space-y-1 text-zinc-400">
          <li>
            <strong className="text-zinc-300">Email:</strong>{' '}
            <a href="mailto:support@tages.ai" className="text-[#3BA3C7] hover:underline">
              support@tages.ai
            </a>
          </li>
          <li>
            <strong className="text-zinc-300">GitHub:</strong>{' '}
            <a
              href="https://github.com/ryantlee25-droid/tages/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3BA3C7] hover:underline"
            >
              github.com/ryantlee25-droid/tages/issues
            </a>
          </li>
        </ul>
      </article>
      <Footer />
    </>
  )
}
