# Changelog

## 0.1.0 (2026-04-06)

### Features
- **Memory Quality Flywheel** — `tages audit` scores memory coverage, `tages sharpen` rewrites to imperative form, `tages session-wrap --refresh-brief` auto-invalidates cached briefs
- **Pre-flight brief injection** — `tages brief` generates a cached context document for system prompt injection with git-based staleness detection
- **Session wrap** — `tages session-wrap` extracts and persists codebase learnings from coding sessions
- **56 MCP tools** — core memory, analytics, quality scoring, deduplication, federation, archival, templates, impact analysis, convention enforcement
- **52 CLI commands** — full control from the terminal
- **Web dashboard** — Next.js 16 with Supabase Auth, project browser, memory viewer, stats, graph visualization
- **Security hardening** — RBAC, RLS on all tables, AES-256-GCM encryption, SHA-256 token hashing, PII/secret detection, audit logging

### Bug Fixes
- Fixed upsert FK violation — removed `id` from all upsert payloads (Postgres generates via `gen_random_uuid()`)
- Fixed `tages status` reporting 0 memories — switched to authenticated Supabase client
- Fixed `tages recall` incomplete results — lowered trigram threshold 0.3 to 0.15, added ILIKE fallback
- Fixed 22 CLI commands using unauthenticated client — all now use `createAuthenticatedClient()`
- Fixed Templates ESM/CJS crash — `createRequire` for CJS interop
- Fixed session-wrap period splitting on file paths

### Tests
- 521 tests total (445 server + 76 CLI), all passing
