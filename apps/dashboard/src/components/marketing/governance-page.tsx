interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="rounded-card border border-line bg-paper-raised/50 p-6 sm:p-8">
      <h2 className="mb-4 text-heading text-ink">{title}</h2>
      <div className="space-y-3 text-ink-soft">{children}</div>
    </div>
  )
}

interface BadgeProps {
  label: string
}

function Badge({ label }: BadgeProps) {
  return (
    <span className="inline-flex items-center rounded-full border border-signal-200 bg-signal-50 px-3 py-0.5 text-xs font-medium text-signal-600">
      {label}
    </span>
  )
}

interface FieldRowProps {
  name: string
  type: string
  description: string
}

function FieldRow({ name, type, description }: FieldRowProps) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-4 align-top">
        <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
          {name}
        </code>
      </td>
      <td className="py-2 pr-4 align-top text-xs text-ink-muted">{type}</td>
      <td className="py-2 align-top text-sm text-ink-soft">{description}</td>
    </tr>
  )
}

export function GovernancePage() {
  return (
    <div className="relative mx-auto max-w-3xl px-6 py-24">
      {/* Header */}
      <div className="mb-16 text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-signal-200 bg-signal-50 px-4 py-1.5 text-sm text-signal-600">
          Memory governance
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          Shared memory your team can{' '}
          <span className="text-signal-600">actually audit</span>
        </h1>
        <p className="mt-6 text-lg text-ink-soft">
          When three developers are using Claude Code, Cursor, and Codex on the same codebase,
          Tages gives you one memory graph with provenance, RBAC, and an audit trail across
          every agent. Memory isn&apos;t storage. It&apos;s a team practice.
        </p>
      </div>

      {/* Badges */}
      <div className="mb-12 flex flex-wrap justify-center gap-2">
        <Badge label="Provenance per write" />
        <Badge label="RBAC + federation" />
        <Badge label="Audit log export" />
        <Badge label="AES-256-GCM opt-in" />
        <Badge label="Secret detection" />
        <Badge label="RLS on every table" />
      </div>

      {/* Sections */}
      <div className="space-y-6">
        <Section title="Why this exists">
          <p>
            Mainstream agent memory frameworks store facts and retrieve them later. That works
            for a solo developer. It breaks when teams ship with AI: decisions get re-litigated,
            conventions drift across agents, and no one can answer &quot;who taught the AI
            that?&quot;
          </p>
          <p>
            Tages treats memory as a governed artifact. Every write records who, what, when,
            and from which agent session. Every memory can be audited, exported, or revoked.
            Federation propagates team decisions; drift detection surfaces when agents have
            learned conflicting things.
          </p>
        </Section>

        <Section title="Provenance model">
          <p>
            Every memory write captures the full context of its origin. This is stored alongside
            the memory value and is queryable via the CLI, MCP tools, and the dashboard.
          </p>
          <div className="mt-4 overflow-x-auto rounded-control border border-line bg-paper/50">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="py-2 pl-3 pr-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Field
                  </th>
                  <th className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Type
                  </th>
                  <th className="py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="pl-3">
                <FieldRow
                  name="user_id"
                  type="uuid"
                  description="Supabase Auth user who initiated the write."
                />
                <FieldRow
                  name="agent_id"
                  type="text"
                  description="Logical agent identifier (e.g., claude-code, cursor, codex, gemini-cli)."
                />
                <FieldRow
                  name="session_id"
                  type="uuid"
                  description="FK to agent_sessions.id. Correlates every tool call within one session."
                />
                <FieldRow
                  name="tool_name"
                  type="text"
                  description="MCP tool that wrote the memory (remember, observe, import, etc.)."
                />
                <FieldRow
                  name="source_context"
                  type="jsonb"
                  description="File path, PR number, commit SHA, or ticket ID associated with the write."
                />
                <FieldRow
                  name="created_at"
                  type="timestamptz"
                  description="Server-side UTC timestamp. Immutable."
                />
                <FieldRow
                  name="confidence"
                  type="numeric"
                  description="0.0–1.0 confidence score (auto-indexer runs, draft-memory captures)."
                />
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink-muted">
            See{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              docs/provenance-model.md
            </code>{' '}
            for the formal specification and migration history.
          </p>
        </Section>

        <Section title="Audit log">
          <p>
            Every memory write, update, delete, and export is recorded in an append-only audit
            log. Entries capture the provenance fields above plus the operation type and the
            RBAC role of the actor at the time of the write.
          </p>
          <p>
            <strong className="text-ink">Retention:</strong> audit rows are retained for
            365 days by default. Self-hosted deployments configure retention via the{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              TAGES_AUDIT_RETENTION_DAYS
            </code>{' '}
            environment variable. Cloud customers on the Governance tier can request extended
            retention (up to 7 years) to meet SOC 2 and HIPAA requirements.
          </p>
          <p>
            <strong className="text-ink">Tamper-evidence:</strong> each audit row is written
            with a row-level hash chained to the previous row within the same project. Any
            modification or deletion breaks the chain and is detectable via{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              tages audit verify
            </code>
            . (Planned for Governance tier; see roadmap.)
          </p>
        </Section>

        <Section title="Export formats">
          <p>
            Audit logs and memory snapshots export on demand in machine-readable formats suitable
            for compliance review.
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm">
            <li>
              <strong className="text-ink-soft">JSON Lines</strong> — one record per line, full
              field fidelity, stable schema version.
            </li>
            <li>
              <strong className="text-ink-soft">CSV</strong> — flattened rows for spreadsheet
              and SIEM ingestion.
            </li>
            <li>
              <strong className="text-ink-soft">NDJSON stream</strong> — for incremental export to
              OpenTelemetry-compatible pipelines (planned).
            </li>
          </ul>
          <p className="text-sm text-ink-muted">
            Run{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              tages audit export --format json --since 2026-01-01
            </code>{' '}
            to export scoped ranges.
          </p>
        </Section>

        <Section title="Erasure &amp; right-to-delete">
          <p>
            Users can request erasure of their own contributions. Project owners can erase any
            memory or user&apos;s writes within a project they own.
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm">
            <li>
              Erasure is a hard delete of the memory row plus redaction of any provenance
              fields containing personal data; the audit event itself is retained as a tombstone
              row with the user reference removed.
            </li>
            <li>
              Federation-propagated copies of erased memories are also redacted on next sync.
            </li>
            <li>
              Cloud customers on paid tiers can request a deletion certificate via support.
            </li>
          </ul>
        </Section>

        <Section title="Role-based access control">
          <p>Three roles at the project scope:</p>
          <ul className="list-inside list-disc space-y-1 text-sm">
            <li>
              <strong className="text-ink-soft">Owner</strong> — full read/write, can manage
              members, rotate tokens, export audit logs, revoke invites.
            </li>
            <li>
              <strong className="text-ink-soft">Admin</strong> — full read/write, can invite
              members but not remove owners, can export audit logs.
            </li>
            <li>
              <strong className="text-ink-soft">Member</strong> — read-only by default; write
              access is grantable per memory type by owners.
            </li>
          </ul>
          <p className="text-sm text-ink-muted">
            Enforced at the Supabase Row Level Security layer (migration 0031 and
            0051_team_rbac_hardening). UI and MCP tools receive the same RLS denials; there is
            no enforcement split between layers.
          </p>
        </Section>

        <Section title="Federation">
          <p>
            Federation lets one team memory propagate to other projects with explicit override
            rules. Security and platform teams can own specific memory types or AGENTS.md
            sections (planned via{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              tages agents-md federate
            </code>
            ) so cross-project conventions stay consistent without manual copy-paste.
          </p>
          <p>
            Every federated memory retains its original provenance record. You can always trace
            a propagated memory back to the team and user that authored it.
          </p>
        </Section>

        <Section title="Drift detection (roadmap)">
          <p>
            When multiple developers run agents on the same codebase, memory state drifts.
            Tages&apos; <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              tages drift
            </code>{' '}
            command computes an Agent Stability Index across semantic, coordination, and
            behavioral drift dimensions, surfacing which memory keys are diverging and why.
          </p>
          <p className="text-sm text-ink-muted">
            Inspired by the Agent Drift paper (arxiv:2601.04170). Shipping in the Governance
            tier.
          </p>
        </Section>

        <Section title="Encryption &amp; transport">
          <p>
            Optional AES-256-GCM field-level encryption for memory values (set{' '}
            <code className="rounded bg-paper-sunken px-1.5 py-0.5 text-xs font-mono text-ink">
              TAGES_ENCRYPTION_KEY
            </code>
            ). All cloud traffic over TLS 1.2+. Supabase Auth with GitHub OAuth for user
            identity; SHA-256 hashed CLI tokens with expiration and rotation.
          </p>
          <p className="text-sm text-ink-muted">
            Full security posture at{' '}
            <a href="/security" className="text-signal-600 hover:underline">
              /security
            </a>
            .
          </p>
        </Section>

        <Section title="Compliance roadmap">
          <ul className="list-inside list-disc space-y-1 text-sm">
            <li>SOC 2 Type I gap analysis in progress (Q3 2026)</li>
            <li>SOC 2 Type I target audit window: Q4 2026 / Q1 2027</li>
            <li>HIPAA readiness: dependent on customer demand; self-hosted BYOK available today</li>
            <li>Data residency: self-hosting on your own Supabase region supported today</li>
          </ul>
          <p className="text-sm text-ink-muted">
            Compliance status is documented openly. Contact{' '}
            <a
              href="mailto:security@tages.ai"
              className="text-signal-600 hover:underline"
            >
              security@tages.ai
            </a>{' '}
            for current attestation artifacts or to request a specific control review.
          </p>
        </Section>

        <Section title="MCP gateway compatibility (roadmap)">
          <p>
            Tages runs behind any MCP-compliant gateway. Integration and compat guides in
            progress for Stacklok ToolHive (Apache 2.0, K8s-native) and TrueFoundry vMCP.
          </p>
        </Section>
      </div>
    </div>
  )
}
