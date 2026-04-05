# HOOK.md — G2-T9 Auth Failure Audit Logging

## Status: in-progress

## Assignment
Create auth audit log table and wire it into auth flows.

## Files Owned
- `supabase/migrations/0033_auth_audit_log.sql` (create)
- `apps/dashboard/src/app/auth/cli/route.ts` (modify)
- `packages/cli/src/auth/token-auth.ts` (modify)

## Findings
- `0032_token_expiry.sql` does not exist — `expires_at` column may not be present yet
- `api_tokens` table has: id, user_id, token_hash, name, created_at, last_used
- `validateToken` in token-auth.ts currently only selects `user_id` — need to also select `expires_at` for expiry check
- `route.ts` uses `createClient()` from `@/lib/supabase/server` — will use same client for audit inserts
- Audit inserts must be fire-and-forget (no await blocking the auth flow)

## Assumptions
- `expires_at` may not exist on `api_tokens` yet; I will select it with `.maybeSingle()` pattern and handle null gracefully
- Service role not available in route.ts context — using same anon/session client for audit inserts
- `token_invalid` = hash lookup returns no row; `token_expired` = row found but expires_at is in the past

## Milestones
- [x] Write HOOK.md
- [x] Write migration 0033_auth_audit_log.sql
- [x] Modify route.ts with audit logging
- [x] Modify token-auth.ts with audit logging
- [ ] Commit

## Status: complete — ready to commit
