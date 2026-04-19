# Plan: Team RBAC — Phase 2 (Invite Flow)
_Created: 2026-04-10 | Type: New Feature (builds on Phase 1 schema foundation)_

## Goal

Ship a working invite flow: CLI commands to invite/manage teammates, server-side acceptance of pending invites on login, and a fixed `invite.ts` that writes the correct Phase 1 schema — so a project owner can invite a colleague by email from the CLI and that colleague gains access automatically when they authenticate.

## Background

Phase 1 landed migrations 0043–0046 which made `user_id` nullable on `team_members`, added `email`/`status`/`invited_by`/`invited_at` columns, and enforced seat limits via trigger. The existing CLI `invite.ts` inserts the old shape (no `status`, no `invited_by`, no nullable `user_id`), which will fail against the new schema. The dashboard invite UI is a placeholder. Phase 2 closes the loop end-to-end: invite by email → user authenticates → membership activates.

## Scope

**In scope:**
- Fix `invite.ts` to write the Phase 1 schema fields
- Migration 0047: `accept_pending_invites` SQL function (SECURITY DEFINER)
- Wire invite acceptance into MCP server startup (after `setSession`)
- New CLI subcommand group: `tages team invite | list | remove | role`
- Update `init --team` flow: pass `invited_by`, add seat-limit preflight
- Update existing `init-team.test.ts` for new insert shape
- New unit tests for `team` subcommand and acceptance wiring

**Out of scope:**
- Dashboard invite UI (Phase 4)
- Email notification sending (no SMTP integration)
- Invite expiry / resend flow
- Migrations 0043–0046 (Phase 1 — assumed landed)

---

## Technical Approach

### Auth identity in CLI commands

`auth.json` at `~/.config/tages/auth.json` stores `{ accessToken, refreshToken, userId }`. The `userId` field is the Supabase UUID of the authenticated user. `createAuthenticatedClient` in `packages/cli/src/auth/session.ts` restores the session from those tokens. Team commands will read `auth.json` directly for `userId` (same pattern as `init.ts` line 82), and call `supabase.auth.getUser()` after `setSession` to get the email (needed for seat-limit checks and display).

### Seat limit preflight

The Phase 1 trigger (migration 0046) enforces the seat cap server-side. The CLI should call `supabase.rpc('seat_limit_for_project', { p_project_id: projectId })` before inserting, fail fast with a readable message, and let the trigger act as a safety net. Pending invites do NOT count toward the cap (constraint is on active members only, per Phase 1 spec).

### accept_pending_invites wiring

In `packages/server/src/index.ts`, after `supabase.auth.setSession(...)` succeeds (line ~118), call `supabase.auth.getUser()` to retrieve the email, then call `supabase.rpc('accept_pending_invites', { user_email: email, uid: userId })`. Log the count accepted. This is fire-and-forget on startup — a failure should warn but not crash the server.

### TeamMember type

`packages/shared/src/types.ts` exports `TeamMember` with `userId: string` (not optional). Phase 1 made `user_id` nullable in Postgres. The TypeScript type must be updated to `userId: string | null` and `email`, `status`, `invitedBy`, `invitedAt` fields added. This is shared infrastructure — the team page (`apps/dashboard`) and server tools that reference `TeamMember` must tolerate nullable `userId`.

**Note: `packages/shared/src/types.ts` is shared infrastructure — changes here affect the dashboard team page, the CLI, and any server tools referencing `TeamMember`. Task 1 must land before Tasks 3 and 4.**

### New CLI command structure

Follows the existing Commander.js pattern in `packages/cli/src/index.ts`. A new `teamCmd` subcommand group is registered similarly to `tokenCmd` (line 131) and `patternsCmd` (line 215). Implementation lives in a new file `packages/cli/src/commands/team.ts`.

---

## Tasks

- [ ] **Task 1: Update TeamMember type in shared** — Add `email`, `status`, `invitedBy`, `invitedAt` fields; make `userId` nullable.
  - Files: `packages/shared/src/types.ts`
  - Tests: Type-only change — verify TypeScript compiles cleanly across packages (`pnpm typecheck`). No runtime test needed.
  - Depends on: nothing
  - Notes: `userId` changes from `string` to `string | null`. New fields: `email: string`, `status: 'pending' | 'active' | 'revoked'`, `invitedBy?: string`, `invitedAt?: string`. Check dashboard `team/page.tsx` line 48 — it reads `m.email || m.user_id` and already handles nulls gracefully; no change needed there.

- [ ] **Task 2: Migration 0047 — accept_pending_invites RPC** — Write the SQL function.
  - Files: `supabase/migrations/0047_accept_pending_invites.sql` (create)
  - Tests: Manual verification via `supabase db reset && supabase db push`. No vitest test (DB integration). Confirm function is callable via `supabase.rpc()`.
  - Depends on: Phase 1 migrations 0044 (schema) — assumed landed
  - Notes: Use exact SQL from the spec. SECURITY DEFINER is required so it can update rows across RLS boundaries. Grant EXECUTE to `authenticated` role.

- [ ] **Task 3: Fix invite.ts to use Phase 1 schema** — Update the insert payload and add `invited_by` parameter.
  - Files: `packages/cli/src/auth/invite.ts`, `packages/cli/src/__tests__/init-team.test.ts`
  - Tests: Update all existing `init-team.test.ts` assertions to expect the new insert shape: `{ project_id, email, role, status: 'pending', invited_by }`. Add a test for the case where `invited_by` is provided. Confirm `user_id` is not in the insert payload (it's NULL by default).
  - Depends on: Task 1 (for TypeScript cleanliness, though runtime is independent)
  - Pre-mortem: If this fails or takes 3x longer, it will be because the mock Supabase client in `init-team.test.ts` is tightly coupled to the old insert shape and needs complete reconstruction, or because the seat-limit trigger (0046) fires in tests where it shouldn't. Solution: keep unit tests using mock Supabase (no real DB) — the trigger only fires on real Supabase.
  - Notes: Signature changes from `inviteTeamMembers(supabase, projectId, emails)` to `inviteTeamMembers(supabase, projectId, emails, invitedBy)`. `invitedBy` is the current user's `userId` (UUID string). `init.ts` already has `userId` in scope at the call site (line 82, 168).

- [ ] **Task 4: New `tages team` CLI subcommand group** — Implement `team invite`, `team list`, `team remove`, `team role`.
  - Files: `packages/cli/src/commands/team.ts` (create), `packages/cli/src/index.ts` (register subcommand)
  - Tests: Create `packages/cli/src/__tests__/team.test.ts`. Test each subcommand with mock Supabase: (a) `invite` inserts correct payload and prints status; (b) `invite` with seat limit exceeded shows clear error; (c) `list` formats pending vs active rows distinctly; (d) `remove` calls DELETE or UPDATE `status='revoked'`; (e) `role` rejects non-owner callers with a clear error.
  - Depends on: Task 1 (type), Task 3 (invite function reused in `team invite`)
  - Pre-mortem: If this fails or takes 3x longer, it will be because the "current user's role" check (needed for `team role` — owner-only) requires a DB round-trip to `team_members` that the unit test mock doesn't handle. Solution: extract a `getUserRole(supabase, projectId, userId)` helper and mock it independently.
  - Notes: `team.ts` should export individual handler functions (not just commander actions) to keep them unit-testable. Register in `index.ts` as `const teamCmd = program.command('team')` following the `patternsCmd` pattern. `team remove` should UPDATE `status = 'revoked'` for pending invites rather than hard DELETE, to preserve audit trail.

- [ ] **Task 5: Update init --team flow** — Pass `invitedBy` to `inviteTeamMembers`, add seat-limit preflight, update status output.
  - Files: `packages/cli/src/commands/init.ts`
  - Tests: Update `packages/cli/src/__tests__/init-team.test.ts` — mock `seat_limit_for_project` RPC returning a value, verify invite call now passes `userId`. Add a test where the seat limit check fails and invite is skipped with a warning.
  - Depends on: Task 3
  - Notes: `userId` is already in scope at the `inviteTeamMembers` call site (line 168 of `init.ts`). Add a check before the invite loop: call `supabase.rpc('seat_limit_for_project', { p_project_id: projectId })` and if the remaining seats are 0, print a warning and skip inviting. Output should show `pending` status next to each invited email (since none will be `active` immediately).

- [ ] **Task 6: Wire accept_pending_invites into MCP server startup** — Call the RPC after session is restored.
  - Files: `packages/server/src/index.ts`
  - Tests: This path is difficult to unit-test without a live DB. Add a smoke test in the existing server test suite that mocks `supabase.auth.getUser()` and `supabase.rpc()` and verifies the RPC is called with the correct arguments after `setSession`. Confirm server does not crash if the RPC returns an error (try/catch with `console.error` warn).
  - Depends on: Task 2 (function must exist in DB), Task 1 (type safety)
  - Pre-mortem: If this fails or takes 3x longer, it will be because `supabase.auth.getUser()` returns `null` for the email field on GitHub OAuth sessions (GitHub returns email as a profile field, not always in `user.email`). Solution: fall back to `user.user_metadata?.email` if `user.email` is null — GitHub OAuth stores it there.
  - Notes: The call site is `packages/server/src/index.ts` around line 118, inside the `if (auth.accessToken && auth.refreshToken)` block, after `setSession` resolves. Pattern: `const { data: { user } } = await supabaseClient.auth.getUser()`. Then: `if (user?.email) { const count = await supabaseClient.rpc('accept_pending_invites', { user_email: user.email, uid: user.id }); console.error('[tages] Accepted pending invites:', count) }`. Wrap entire block in try/catch.

---

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| Task 1 — shared type | — | `packages/shared/src/types.ts` |
| Task 2 — migration | `supabase/migrations/0047_accept_pending_invites.sql` | — |
| Task 3 — fix invite.ts | — | `packages/cli/src/auth/invite.ts`, `packages/cli/src/__tests__/init-team.test.ts` |
| Task 4 — team CLI | `packages/cli/src/commands/team.ts`, `packages/cli/src/__tests__/team.test.ts` | `packages/cli/src/index.ts` |
| Task 5 — init --team | — | `packages/cli/src/commands/init.ts`, `packages/cli/src/__tests__/init-team.test.ts` |
| Task 6 — server wiring | — | `packages/server/src/index.ts` |

**File conflict check:** `init-team.test.ts` appears in both Task 3 and Task 5. Resolution: make Task 5 sequential after Task 3. Task 3 updates the existing test assertions for the new insert shape; Task 5 adds new test cases for the seat-limit preflight. No parallel execution conflict if done in order.

---

## Open Questions

- [ ] **Does migration 0046 (seat trigger) count pending invites?** — Blocks: Task 5 (preflight logic). Default if unresolved: assume pending invites do NOT count (per spec). Verify by reading migration 0046 when it lands. Who: whoever writes 0046.
- [ ] **Does `supabase.auth.getUser()` reliably return email for GitHub OAuth users?** — Blocks: Task 6. Default if unresolved: also check `user.user_metadata?.email` as fallback (GitHub always populates this). Who: implementer of Task 6.
- [ ] **Should `team remove` hard-delete or soft-revoke for active members?** — Blocks: Task 4. Default if unresolved: soft-revoke (UPDATE `status = 'revoked'`) for both pending and active, to preserve audit trail. Who: product decision — confirm before Task 4 starts.

---

## Definition of Done

- [ ] Code written and self-reviewed
- [ ] `pnpm typecheck` passes across all packages (critical — shared type change)
- [ ] `pnpm test` passes — all existing tests plus new tests for Tasks 3, 4, 5, 6
- [ ] Migration 0047 applies cleanly via `supabase db push` against a local Supabase instance
- [ ] Manual smoke test: `tages init --team`, enter an email, confirm row in `team_members` with `status='pending'`
- [ ] Manual smoke test: authenticate as the invited email, confirm row updates to `status='active'`
- [ ] PR opened with coverage gaps noted in description
