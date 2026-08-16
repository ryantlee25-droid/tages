import { Rule, Section, SectionHead } from './ui'

/**
 * A definition list, not a card grid. Each row is a real memory type from
 * packages/shared/src/types.ts with an example of what an agent would store,
 * so the section demonstrates the vocabulary instead of describing it.
 */
const types = [
  {
    type: 'convention',
    example: 'API routes are snake_case. Components are PascalCase, one per file.',
  },
  {
    type: 'decision',
    example: 'Chose Postgres over Mongo for pg_trgm fuzzy search. Revisit if write volume passes 10k/s.',
  },
  {
    type: 'architecture',
    example: 'Auth middleware lives in lib/auth.ts. JWTs are in httpOnly cookies, never localStorage.',
  },
  {
    type: 'lesson',
    example: 'Don’t cache the Supabase mock between tests — they need fresh state or ordering leaks.',
  },
  {
    type: 'anti_pattern',
    example: 'Never pass id in an upsert with onConflict. It causes a foreign-key violation.',
  },
  {
    type: 'pattern',
    example: 'Every API error returns { error, code, status }. Clients switch on code, never on message.',
  },
]

export function Memory() {
  return (
    <Section>
      <SectionHead
        title="Source code says what exists. Memory says why."
        lead="Eleven structured types, so a memory is a typed fact an agent can act on rather than a paragraph it has to interpret. These are six of them."
      />

      <dl className="mt-14">
        {types.map((t, i) => (
          <div key={t.type}>
            {i > 0 ? <Rule className="my-6" /> : null}
            <div className="grid gap-2 sm:grid-cols-[11rem_1fr] sm:gap-8">
              <dt className="font-mono text-sm text-signal-600">{t.type}</dt>
              <dd className="measure text-ink">{t.example}</dd>
            </div>
          </div>
        ))}
      </dl>
    </Section>
  )
}
