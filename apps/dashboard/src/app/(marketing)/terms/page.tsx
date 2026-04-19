import type { Metadata } from 'next'
import { Footer } from '@/components/marketing/footer'

export const metadata: Metadata = {
  title: 'Terms of Service | Tages',
  description:
    'Terms of service for Tages — AI agent memory for coding teams. GitHub OAuth accounts, Stripe billing, acceptable use, and liability terms.',
}

export default function TermsPage() {
  return (
    <>
      <article className="mx-auto max-w-3xl px-6 py-20 prose prose-invert">
        <h1 className="text-4xl font-bold text-white">Terms of Service</h1>
        <p className="text-zinc-400">
          <strong className="text-zinc-300">Effective date:</strong> April 18, 2026
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">1. Acceptance of Terms</h2>
        <p className="text-zinc-400">
          By accessing or using Tages (available at tages.ai and as open-source software at
          github.com/ryantlee25-droid/tages), you agree to be bound by these Terms of Service and
          our{' '}
          <a href="/privacy" className="text-[#3BA3C7] hover:underline">
            Privacy Policy
          </a>. If you do not agree, do not use the service. These terms apply to all users,
          including free-tier users, paid subscribers, and self-hosted deployments that connect to
          tages.ai infrastructure.
        </p>
        <p className="text-zinc-400">
          We may update these terms from time to time. Continued use of the service after changes
          are published constitutes acceptance of the updated terms. We will provide at least 30
          days notice before material changes take effect.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">2. Service Description</h2>
        <p className="text-zinc-400">
          Tages provides AI agent memory as a hosted cloud service and as open-source software for
          self-hosting. The hosted service stores codebase memories — structured key/value pairs
          that AI coding agents use to maintain context across sessions — in Supabase Postgres with
          optional SQLite local caching.
        </p>
        <p className="text-zinc-400">
          The open-source server, CLI, and SDK are available under the MIT license and may be used
          independently of the hosted service. These terms govern use of the hosted service at
          tages.ai. Self-hosted deployments that do not use tages.ai infrastructure are governed
          solely by the MIT license.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">3. User Accounts</h2>
        <p className="text-zinc-400">
          Access to the hosted service requires a GitHub account, used for OAuth authentication
          via Supabase. You are responsible for maintaining the security of your GitHub credentials
          and any CLI tokens issued by Tages. Do not share tokens. Rotate them immediately if
          compromised using{' '}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs font-mono text-zinc-200">tages token rotate</code>.
        </p>
        <p className="text-zinc-400">
          You are responsible for all activity that occurs under your account. We reserve the right
          to suspend or terminate accounts that violate these terms. Accounts that have been
          inactive for 24 months may be purged after 30 days notice to the email address on file.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">4. Subscriptions and Billing</h2>
        <p className="text-zinc-400">
          Paid plans (Pro and Team) are billed monthly on a recurring basis. Payments are processed
          by Stripe. By subscribing, you authorize Stripe to charge your payment method on the
          billing cycle date. All prices are in US dollars and exclusive of any applicable taxes.
        </p>
        <p className="text-zinc-400">
          You may cancel your subscription at any time via the Stripe customer portal, accessible
          from your account settings. Cancellation takes effect at the end of the current billing
          period. We do not issue refunds for partial months. For annual plans (if offered), a
          14-day refund window applies from the date of initial purchase; no refunds are issued
          after that window. We reserve the right to change pricing with 30 days advance notice to
          subscribers.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">5. Acceptable Use</h2>
        <p className="text-zinc-400">
          You agree not to use Tages to store, transmit, or process illegal content, including
          content that infringes intellectual property rights, contains malware, or violates
          applicable privacy laws. You agree not to attempt to circumvent tier limits, access
          controls, or rate limits through automated means or by creating multiple accounts. You
          agree not to resell or sublicense the hosted service to third parties without written
          permission.
        </p>
        <p className="text-zinc-400">
          We reserve the right to remove content and suspend accounts that violate these policies.
          Egregious or repeated violations may result in immediate termination without refund.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">6. Intellectual Property</h2>
        <p className="text-zinc-400">
          You own the memories and codebase context you store in Tages. We claim no intellectual
          property rights over your content. You grant us a limited license to store, process, and
          return your content solely for the purpose of providing the service.
        </p>
        <p className="text-zinc-400">
          Tages (the hosted service, dashboard, and infrastructure) is owned by its creators. The
          Tages open-source software (server, CLI, SDK) is separately licensed under the MIT
          license. The MIT license is not affected by these terms.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">7. Data and Privacy</h2>
        <p className="text-zinc-400">
          Our data practices are described in our{' '}
          <a href="/privacy" className="text-[#3BA3C7] hover:underline">
            Privacy Policy
          </a>, which is incorporated by reference into these terms. We do not sell your data. We
          do not train AI models on your data. In local-only mode, no data is transmitted to our
          servers.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">8. Termination</h2>
        <p className="text-zinc-400">
          Either party may terminate the subscription at any time. You may cancel via the Stripe
          customer portal. We may terminate your account for violations of these terms, non-payment,
          or at our discretion with 30 days notice.
        </p>
        <p className="text-zinc-400">
          Upon termination, your data is retained for 30 days during which you may export it via
          the CLI or dashboard. After 30 days, all user data associated with your account is
          permanently deleted from our systems. Supabase database backups are purged within 7 days
          of the deletion cycle.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">9. Limitation of Liability</h2>
        <p className="text-zinc-400">
          The service is provided &quot;as is&quot; without warranties of any kind, express or
          implied, including but not limited to warranties of merchantability, fitness for a
          particular purpose, or non-infringement. We do not warrant that the service will be
          uninterrupted, error-free, or free of security vulnerabilities.
        </p>
        <p className="text-zinc-400">
          To the maximum extent permitted by applicable law, our total liability to you for any
          claims arising from your use of the service is capped at the total fees you paid in the
          12 months preceding the claim. We are not liable for indirect, incidental, special,
          consequential, or punitive damages, including loss of data, loss of profits, or business
          interruption, even if we have been advised of the possibility of such damages.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">10. Governing Law</h2>
        {/* TODO: confirm jurisdiction with legal */}
        <p className="text-zinc-400">
          These terms are governed by the laws of the State of Colorado, United States, without
          regard to its conflict of law provisions. Any disputes arising from these terms or your
          use of the service will be resolved in the state or federal courts located in Colorado.
          You consent to personal jurisdiction in those courts.
        </p>
        <p className="text-zinc-400">
          If you are located outside the United States, local mandatory consumer protection laws
          may grant you additional rights that these terms do not limit.
        </p>

        <hr className="my-8 border-zinc-800" />

        <h2 className="text-2xl font-semibold text-white">11. Contact</h2>
        <p className="text-zinc-400">
          Questions about these terms or the service:
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
