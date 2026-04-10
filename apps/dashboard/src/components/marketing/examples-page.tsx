import Link from 'next/link'

interface MemoryCardProps {
  type: string
  memoryKey: string
  value: string
  files?: string[]
  typeColor: string
}

function MemoryCard({ type, memoryKey, value, files, typeColor }: MemoryCardProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${typeColor}20`, color: typeColor, border: `1px solid ${typeColor}40` }}
        >
          {type}
        </span>
        <span className="font-mono text-sm text-white">{memoryKey}</span>
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed">{value}</p>
      {files && files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map(f => (
            <span key={f} className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-500">{f}</span>
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
        <h3 className="text-lg font-semibold text-white">{name}</h3>
        <p className="text-sm text-zinc-500">{description}</p>
      </div>
      <div className="space-y-3">
        {memories.map(m => <MemoryCard key={m.memoryKey} {...m} />)}
      </div>
    </div>
  )
}

const TYPE_COLORS: Record<string, string> = {
  convention: '#3BA3C7',
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
        <div className="mb-6 inline-flex items-center rounded-full border border-[#3BA3C7]/30 bg-[#3BA3C7]/10 px-4 py-1.5 text-sm text-[#3BA3C7]">
          Real examples
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          What agents{' '}
          <span style={{ color: '#3BA3C7' }}>actually remember</span>
        </h1>
        <p className="mt-6 text-lg text-zinc-400">
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
            style={{ backgroundColor: `${color}15`, color, border: `1px solid ${color}30` }}
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

        <div className="border-t border-zinc-800" />

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

        <div className="border-t border-zinc-800" />

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
      <div className="mt-20 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <h2 className="text-xl font-semibold text-white">See it in your codebase</h2>
        <p className="mt-2 text-zinc-400">
          Two commands. Your agents start remembering.
        </p>
        <div className="mt-4 inline-block overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-6 py-3 font-mono text-xs sm:text-sm">
          <span className="text-zinc-500">$</span>{' '}
          <span className="text-green-400">npm install -g @tages/cli</span>{' '}
          <span className="text-zinc-600">&&</span>{' '}
          <span className="text-green-400">tages init</span>
        </div>
        <div className="mt-6">
          <Link
            href="/auth/login"
            className="rounded-lg px-8 py-3 text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ backgroundColor: '#3BA3C7' }}
          >
            Try the demo
          </Link>
        </div>
      </div>
    </div>
  )
}
