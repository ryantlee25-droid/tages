# Changelog

## Unreleased (2026-04-18)

### Features
- **Stripe billing end-to-end** — Pro ($14/mo) and Team ($29/seat/mo, 1–20 seats) checkout flows live. Webhook handles `subscription.updated` for plan changes and seat count sync. Customer portal linked from upgrade page.
- **Seat picker** — Team checkout includes a 1–20 seat selector with live monthly total.
- **Marketing pricing CTAs** — "Coming soon" / mailto links replaced with real checkout.
- **Memory authorship + conflict attribution** — all memory writes now record `created_by` (agent/user who first stored the entry) and `last_edited_by` (agent/user of the most recent update). New `get_memory_authors` RPC surfaces per-memory attribution. Conflict resolver UI shows author names for each conflicting version. Existing rows retain NULL attribution and display as "Unknown" in the UI — no backfill attempted.

### Fixes
- Plan propagation: webhook now syncs `user_profiles.plan` → all owned `projects.plan` rows so MCP tier gate and seat-limit function see the upgraded tier (previously a no-op sync left projects on 'free').

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
