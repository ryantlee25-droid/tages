# HOOK.md — Howler F: G3-T19 Pen Test Readiness Document

## Status: in-progress

## Task
CREATE `docs/PEN-TEST-READINESS.md`

## Orientation Complete
- No CONTRACT.md found in worktree (solo task, no spectrum dir)
- SECURITY.md read: disclosure policy, scope, out-of-scope, safe harbor
- API routes: `api/projects/[slug]/export`, `api/stripe/checkout`, `api/stripe/portal`, `api/stripe/webhook`
- Auth routes: `auth/callback`, `auth/cli`, `auth/login`, `auth/signout`
- CLI token auth: SHA-256 hashed tokens, expiry checks, audit logging (`packages/cli/src/auth/token-auth.ts`)
- MCP server: 30 tools over stdio transport, SQLite cache + Supabase sync
- Middleware at: `apps/dashboard/src/lib/supabase/middleware.ts`
- Architecture: RBAC, RLS, AES-256-GCM optional encryption, Zod input validation, 1MB request limits

## Milestones
- [x] Orient (Phase 1)
- [x] Write HOOK.md
- [x] Write docs/PEN-TEST-READINESS.md
- [ ] Commit to worktree branch

## Seams
None — solo CREATE task, no integration with other Howlers.
