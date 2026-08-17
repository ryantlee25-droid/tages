import Link from 'next/link'

interface MemoryCardProps {
  type: string
  memoryKey: string
  value: string
  files?: string[]
  typeColor: string
}

/**
 * Tints a type colour for the pill background and border.
 *
 * This used to be string concatenation (`${color}15`), which silently produced no
 * capsule at all for any colour that was not a bare hex: `var(--color-signal-600)15`
 * is not a colour, so the declaration was dropped and `convention` alone rendered as
 * naked text while every other type got a pill. `color-mix` works for hex and for
 * `var()` alike, so a token-valued colour cannot break the shape again.
 */
function tint(color: string, percent: number) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

function MemoryCard({ type, memoryKey, value, files, typeColor }: MemoryCardProps) {
  return (
    <div className="rounded-control border border-line bg-paper-raised/50 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: tint(typeColor, 12), color: typeColor, border: `1px solid ${tint(typeColor, 25)}` }}
        >
          {type}
        </span>
        <span className="font-mono text-sm text-ink">{memoryKey}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{value}</p>
      {files && files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map(f => (
            <span key={f} className="rounded bg-paper-sunken px-2 py-0.5 font-mono text-xs text-ink-muted">{f}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function ExampleProject({ name, description, memories }: {
  name: string
  description: string
  memories: MemoryCardProps[]
}) {
  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-ink">{name}</h3>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <div className="space-y-3">
        {memories.map(m => <MemoryCard key={m.memoryKey} {...m} />)}
      </div>
    </div>
  )
}

const TYPE_COLORS: Record<string, string> = {
  convention: 'var(--color-signal-600)',
  decision: '#A78BFA',
  architecture: '#60A5FA',
  lesson: '#FBBF24',
  anti_pattern: '#EF4444',
  pattern: '#34D399',
  execution: '#F97316',
  entity: '#8B5CF6',
}

export function ExamplesPage() {
  return (
    <div className="relative mx-auto max-w-3xl px-6 py-24">
      {/* Header */}
      <div className="mb-16 text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-signal-200 bg-signal-50 px-4 py-1.5 text-sm text-signal-600">
          Real examples
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
          What agents{' '}
          <span className="text-signal-600">actually remember</span>
        </h1>
        <p className="mt-6 text-lg text-ink-soft">
          These are real memories from production projects. This is what your AI tools
          see at the start of every session. The context that prevents mistakes.
        </p>
      </div>

      {/* Type legend */}
      <div className="mb-12 flex flex-wrap justify-center gap-2">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span
            key={type}
            className="inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium"
            style={{ backgroundColor: tint(color, 8), color, border: `1px solid ${tint(color, 19)}` }}
          >
            {type.replace('_', ' ')}
          </span>
        ))}
      </div>

      {/* Projects */}
      <div className="space-y-16">
        <ExampleProject
          name="Next.js SaaS App"
          description="A typical web app with authentication, API routes, and a database"
          memories={[
            {
              type: 'anti_pattern', memoryKey: 'no-manual-message-objects', typeColor: TYPE_COLORS.anti_pattern,
              value: 'NEVER construct message objects manually as {id, text, type}. ALWAYS import msg/systemMsg/errorMsg from lib/messages.ts. These were extracted from 10 duplicate definitions.',
              files: ['lib/messages.ts'],
            },
            {
              type: 'convention', memoryKey: 'api-error-format', typeColor: TYPE_COLORS.convention,
              value: 'All API routes return { error: string, code: string, status: number } on failure. Use the shared errorResponse() helper from lib/api-utils.ts. Never throw raw errors from route handlers.',
              files: ['lib/api-utils.ts'],
            },
            {
              type: 'decision', memoryKey: 'chose-supabase-auth', typeColor: TYPE_COLORS.decision,
              value: 'Chose Supabase Auth over NextAuth. Rationale: built-in RLS integration, no adapter boilerplate, GitHub OAuth out of the box. Trade-off: vendor lock-in on auth, but acceptable since DB is already Supabase.',
            },
            {
              type: 'lesson', memoryKey: 'jsonb-not-stringify', typeColor: TYPE_COLORS.lesson,
              value: 'Supabase handles JSONB serialization automatically. Passing JSON.stringify() to a JSONB column double-encodes it, causing parse failures on read. Two production outages from this.',
              files: ['lib/supabase.ts'],
            },
            {
              type: 'execution', memoryKey: 'add-api-route', typeColor: TYPE_COLORS.execution,
              value: 'Adding an API route: 1) Create file in app/api/<path>/route.ts. 2) Export async function for HTTP method (GET, POST, etc). 3) Add Zod validation for request body. 4) Use createClient() from lib/supabase/server.ts for DB access. 5) Add rate limiting if public-facing.',
              files: ['app/api/', 'lib/supabase/server.ts'],
            },
          ]}
        />

        <div className="border-t border-line" />

        <ExampleProject
          name="Game Engine (30k LOC)"
          description="A text-based game with combat, inventory, factions, and 271 hand-crafted rooms"
          memories={[
            {
              type: 'anti_pattern', memoryKey: 'save-field-migration', typeColor: TYPE_COLORS.anti_pattern,
              value: 'NEVER add a field to _savePlayer() without a matching Supabase migration. Two production outages caused by this. ALWAYS create migration FIRST. NEVER JSON.stringify() JSONB fields.',
              files: ['lib/gameEngine.ts', 'supabase/migrations/'],
            },
            {
              type: 'pattern', memoryKey: 'room-spawn-pattern', typeColor: TYPE_COLORS.pattern,
              value: 'When adding spawnable entities to rooms (enemies, NPCs, bosses), add spawn data directly to room definitions in data/rooms/<zone>.ts. NEVER create a separate spawn system. Rooms own their spawn tables.',
              files: ['data/rooms/'],
            },
            {
              type: 'architecture', memoryKey: 'combat-system', typeColor: TYPE_COLORS.architecture,
              value: '6 status effects: bleed, burn, stun, frighten, poison, weaken. Hemorrhagic shock = bleed+burn combo. This is the ONLY condition combo. Do not add more. Conditions tick each combat round.',
              files: ['lib/conditions.ts'],
            },
            {
              type: 'execution', memoryKey: 'add-command-recipe', typeColor: TYPE_COLORS.execution,
              value: 'Adding a command: 1) Register verb + aliases in lib/parser.ts. 2) Add case in lib/gameEngine.ts dispatch switch. 3) Create handler in lib/actions/<domain>.ts. 4) Import handler in gameEngine.ts. All three files must be updated.',
              files: ['lib/parser.ts', 'lib/gameEngine.ts', 'lib/actions/'],
            },
            {
              type: 'convention', memoryKey: 'rich-text-tags', typeColor: TYPE_COLORS.convention,
              value: 'ALWAYS use rt helper for terminal output: rt.item(), rt.npc(), rt.enemy(), rt.condition(), rt.keyword(). NEVER output raw text for game entities. The terminal parser colorizes tagged content.',
              files: ['lib/richText.ts', 'components/Terminal.tsx'],
            },
          ]}
        />

        <div className="border-t border-line" />

        <ExampleProject
          name="MCP Server (monorepo)"
          description="A TypeScript monorepo with CLI, server, shared types, and a dashboard"
          memories={[
            {
              type: 'convention', memoryKey: 'supabase-promiselike', typeColor: TYPE_COLORS.convention,
              value: 'Supabase returns PromiseLike not Promise. MUST wrap with Promise.resolve() for .catch(). Multiple past type errors from this.',
            },
            {
              type: 'pattern', memoryKey: 'cli-server-build-order', typeColor: TYPE_COLORS.pattern,
              value: 'Server must be built before CLI. CLI has cross-package imports that reference server/src/ with @ts-ignore. pnpm build handles order, but pnpm --filter cli build alone will fail.',
            },
            {
              type: 'entity', memoryKey: 'storage-tiers', typeColor: TYPE_COLORS.entity,
              value: 'Hot: SQLite (better-sqlite3) for sub-10ms local queries. Warm: Supabase Postgres with pg_trgm + pgvector. Cold: Archive table for stale memories. WAL recovery on crash.',
            },
            {
              type: 'decision', memoryKey: 'no-procedural-gen', typeColor: TYPE_COLORS.decision,
              value: 'Procedural generation was built and then deleted. Replaced with hand-crafted content for better quality. Do NOT reintroduce. This was a deliberate design decision.',
            },
          ]}
        />
      </div>

      {/* CTA */}
      <div className="mt-20 rounded-card border border-line bg-paper-raised/50 p-8 text-center">
        <h2 className="text-heading text-ink">See it in your codebase</h2>
        <p className="mt-2 text-ink-soft">
          Two commands. Your agents start remembering.
        </p>
        <div className="mt-4 inline-block overflow-x-auto rounded-control border border-line bg-paper px-6 py-3 font-mono text-xs sm:text-sm">
          <span className="text-ink-muted">$</span>{' '}
          <span className="text-green-400">npm install -g @tages/cli</span>{' '}
          <span className="text-ink-muted">&&</span>{' '}
          <span className="text-green-400">tages init</span>
        </div>
        <div className="mt-6">
          <Link
            href="/auth/login"
            className="rounded-control px-8 py-3 text-sm font-medium text-ink transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--color-signal-600)' }}
          >
            Try the demo
          </Link>
        </div>
      </div>
    </div>
  )
}
