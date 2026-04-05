-- ============================================================
-- Tages — Seed Data (local dev only)
-- Demo project with 5 sample memories
-- ============================================================

-- Create a demo user profile (assumes local dev user exists)
-- In local Supabase, the default test user ID is used
-- We'll insert into projects directly; RLS is bypassed in seed

-- Demo project
insert into projects (id, name, slug, owner_id, git_remote, default_branch)
values (
  '00000000-0000-0000-0000-000000000001',
  'demo-project',
  'demo-project',
  '00000000-0000-0000-0000-000000000000', -- placeholder; local dev
  'https://github.com/example/demo-project',
  'main'
);

-- 5 sample memories
insert into memories (project_id, key, value, type, source, confidence) values
(
  '00000000-0000-0000-0000-000000000001',
  'naming-convention-components',
  'React components use PascalCase filenames and named exports. No default exports. Example: UserProfile.tsx exports function UserProfile().',
  'convention',
  'manual',
  1.0
),
(
  '00000000-0000-0000-0000-000000000001',
  'api-error-format',
  'All API routes return errors as { error: string, code: string, status: number }. Never throw raw Error objects in route handlers.',
  'convention',
  'manual',
  1.0
),
(
  '00000000-0000-0000-0000-000000000001',
  'chose-supabase-over-firebase',
  'Chose Supabase over Firebase for the backend. Rationale: Postgres gives us pg_trgm fuzzy search, RLS for row-level security, and we avoid vendor lock-in on the query layer.',
  'decision',
  'manual',
  1.0
),
(
  '00000000-0000-0000-0000-000000000001',
  'monorepo-layout',
  'packages/server is the MCP server, packages/cli is the CLI, packages/shared has types + Supabase client. apps/dashboard is the Next.js dashboard. All packages are TypeScript with strict mode.',
  'architecture',
  'auto_index',
  0.9
),
(
  '00000000-0000-0000-0000-000000000001',
  'sqlite-cache-gotcha',
  'better-sqlite3 is synchronous — do not call it inside async hot paths without wrapping. The cache layer uses synchronous reads intentionally for sub-10ms latency, but writes should be batched.',
  'lesson',
  'agent',
  0.8
);

-- A sample decision log entry
insert into decision_log (project_id, decision, rationale, files_affected)
values (
  '00000000-0000-0000-0000-000000000001',
  'Use pg_trgm over pgvector for v1 search',
  'pgvector requires embedding generation (extra LLM call per memory write). pg_trgm gives us good-enough fuzzy matching with zero external dependencies. We can upgrade to pgvector in v2 if users need semantic search.',
  '{packages/server/src/tools/recall.ts, supabase/migrations/0003_trgm_indexes.sql}'
);
