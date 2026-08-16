import { Rule, Section, SectionHead } from './ui'

const facts = [
  {
    title: 'One index, explicit membership',
    body:
      'An owner invites by email. Membership is enforced in the database with row-level security, not in the client, so a non-member gets nothing rather than a filtered view.',
  },
  {
    title: 'Owners and admins write, members read',
    body:
      'Roles are checked at the database layer. A read-only teammate cannot quietly poison the index everyone else depends on.',
  },
  {
    title: 'Memory is a managed artifact',
    body:
      'Audit coverage, score quality, dedupe near-identical entries, and rewrite vague notes into imperative instructions an agent can follow. Bad memory gets corrected before it misleads the next session.',
  },
  {
    title: 'Local cache, cloud truth',
    body:
      'Reads come from a local SQLite cache for speed and keep working offline. Writes sync to Postgres so the rest of the team sees them.',
  },
]

export function Teams() {
  return (
    <Section>
      <SectionHead
        title="Built for an index several people write to."
        lead="Personal memory tools assume one developer who remembers what they stored. The moment a second person writes, the hard problems are correctness and trust."
      />

      <div className="mt-14 grid gap-x-16 gap-y-10 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.title}>
            <h3 className="text-heading text-ink">{f.title}</h3>
            <p className="mt-2.5 text-ink-soft">{f.body}</p>
          </div>
        ))}
      </div>

      <Rule className="my-12" />

      <p className="measure text-body text-ink-soft">
        Agents reach it through <strong className="font-medium text-ink">56 MCP tools</strong>,
        and you drive the same data from <strong className="font-medium text-ink">42 CLI
        commands</strong> — remember, recall, audit, sharpen, dedupe, drift. Both counts are
        read off the shipped build, not the docs.
      </p>

    </Section>
  )
}
