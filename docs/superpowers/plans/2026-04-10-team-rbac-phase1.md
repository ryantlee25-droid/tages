# Plan: Team RBAC — Phase 1 (Schema Foundation)
_Created: 2026-04-10 | Type: New Feature_

## Goal

Lay the database and TypeScript tier-config foundation required for team plan billing enforcement: a `plan` column on projects, invite-ready team_members schema, tier-aware memory and seat limits in SQL, and `TEAM_TOOLS` support in the server gate.

## Background

Tages has three user tiers (free, pro, team) but `projects` has no `plan` column — tier enforcement is scattered between `user_profiles.is_pro` and hard-coded constants. The `team_members` table has no invite lifecycle columns, blocking Phase 2's email-invite flow. This phase makes the schema authoritative for project-level plan tracking and wires the TypeScript gate to recognize the team plan.

## Scope

**In scope:**
- Migration 0043: add `plan` column to `projects`
- Migration 0044: extend `team_members` with invite lifecycle columns and relax `user_id NOT NULL`
- Migration 0045: replace hard-coded 10,000 memory cap with `memory_limit_for_project()` function and updated RLS policy
- Migration 0046: add `seat_limit_for_project()` function + `enforce_seat_limit` trigger
- `tier-config.ts`: add `TEAM_TOOLS` constant
- `tier-gate.ts`: handle `'team'` plan in `gateCheck`
- `tier-config.test.ts`: extend to cover TEAM_TOOLS
- `e2e-tier-enforcement.test.ts`: extend to cover seat-limit trigger behavior

**Out of scope:**
- Stripe billing integration or webhook handling (Phase 2+)
- Email invite sending or invite-token generation (Phase 2)
- Dashboard UI changes
- Migrating `user_profiles.is_pro` usage — `is_pro()` RLS helper continues to work unchanged for legacy free/pro checks

## Technical Approach

### Migration sequencing

Migrations must run in order. 0042 is the current head. New files:
- `supabase/migrations/0043_projects_plan_column.sql`
- `supabase/migrations/0044_team_members_invite_columns.sql`
- `supabase/migrations/0045_tier_aware_memory_limits.sql`
- `supabase/migrations/0046_seat_limits.sql`

Each migration is idempotent where possible (use `IF NOT EXISTS`, `OR REPLACE`, `DROP POLICY IF EXISTS`).

### Backward compatibility

`projects.plan` defaults to `'free'` — existing rows are unaffected. The new memory limit function returns 10,000 for `'free'`, identical to the current hard-coded cap. The new RLS policy replaces only the INSERT policy introduced in 0034; SELECT/UPDATE/DELETE policies are untouched.

### `is_write_authorized` interaction with `user_id` nullable change

In 0044 we drop `NOT NULL` from `team_members.user_id`. The existing `is_write_authorized()` function (0031) queries `team_members WHERE user_id = uid AND role IN ('owner', 'admin')`. Pending rows (no `user_id`) will never match because `NULL = uid` is false in SQL — no behavioral change needed to that function.

### `is_project_member` interaction

Similarly, `is_project_member()` (0002) queries `team_members WHERE user_id = uid` — pending rows won't match, which is correct: a pending invite is not yet a member.

### search_path on new functions

Migration 0042 set `search_path = public, extensions` on all existing functions. New functions created in 0045 and 0046 must include `SET search_path = public, extensions` explicitly to satisfy the same linter rule, avoiding a repeat of the 0042 remediation.

Note: `memory_limit_for_project` and `seat_limit_for_project` are marked `STABLE` (read-only, same result per transaction). `check_seat_limit` is a trigger function and cannot be marked STABLE — it is `VOLATILE` by default, which is correct.

### Tier gate in TypeScript

`gateCheck` in `tier-gate.ts` currently passes any non-`'free'` plan through (`if (effectivePlan !== 'free') return null`). This already works for `'team'` — no gate logic change is strictly needed. However, `TEAM_TOOLS` should be declared explicitly in `tier-config.ts` to make team-specific tooling expressible in the future and to give the test suite a typed surface to assert on. For Phase 1, `TEAM_TOOLS` equals `ALL_TOOLS` (team gets everything).

---

## Tasks

### Task 1: Migration 0043 — Add `plan` column to `projects`

- **Files (create):** `supabase/migrations/0043_projects_plan_column.sql`
- **SQL:**
  ```sql
  ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'team'));
  ```
- **Tests:** No server unit test needed — this is a DDL-only change. Verify column exists in local Supabase dev instance with `\d projects`. Backward compat: run existing test suite with `pnpm --filter server test` and confirm zero failures.
- **Depends on:** nothing
- **Notes:** `ADD COLUMN IF NOT EXISTS` makes the migration re-runnable. The `DEFAULT 'free'` ensures all existing rows get the correct tier without a backfill step. The `project-factory.ts` `createCloudProject` function already selects `plan` — it will begin receiving real values after this migration lands.

---

### Task 2: Migration 0044 — Extend `team_members` for invite lifecycle

- **Files (create):** `supabase/migrations/0044_team_members_invite_columns.sql`
- **SQL (in order):**
  1. Add `email`, `status`, `invited_by`, `invited_at` columns
  2. `ALTER COLUMN user_id DROP NOT NULL`
  3. Add partial unique index `team_members_pending_email ON team_members(project_id, email) WHERE status = 'pending'`
- **Full SQL:**
  ```sql
  ALTER TABLE team_members
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
      CHECK (status IN ('pending', 'active', 'revoked')),
    ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS invited_at timestamptz DEFAULT now();

  ALTER TABLE team_members ALTER COLUMN user_id DROP NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS team_members_pending_email
    ON team_members(project_id, email)
    WHERE status = 'pending';
  ```
- **Tests:** Run existing test suite. Verify that `is_project_member` and `is_write_authorized` still pass (their logic is unaffected by the nullable change, but the test suite exercises those code paths indirectly).
- **Depends on:** Task 1 (same migration run — ordering matters for Supabase CLI)
- **Pre-mortem:** If this fails, it will be because Supabase does not allow dropping NOT NULL on a column that has an existing UNIQUE constraint referencing it. Resolution: drop the unique constraint first, alter the column, re-add the constraint (or use the partial index as the uniqueness mechanism for active members).
- **Notes:** Existing rows all have a real `user_id` and will default to `status = 'active'` — no data loss. The `ADD COLUMN IF NOT EXISTS` guards prevent re-run errors.

---

### Task 3: Migration 0045 — Tier-aware memory limits

- **Files (create):** `supabase/migrations/0045_tier_aware_memory_limits.sql`
- **SQL:**
  ```sql
  CREATE OR REPLACE FUNCTION memory_limit_for_project(pid uuid)
  RETURNS integer AS $$
    SELECT CASE
      WHEN p.plan = 'team' THEN 100000
      WHEN p.plan = 'pro'  THEN 50000
      ELSE 10000
    END
    FROM projects p WHERE p.id = pid;
  $$ LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path = public, extensions;

  -- Replace the 0034 hard-coded INSERT policy
  DROP POLICY IF EXISTS "Write-authorized users can insert memories (free: max 10000)" ON memories;

  CREATE POLICY "Write-authorized users can insert memories (tier-aware limit)"
    ON memories FOR INSERT
    WITH CHECK (
      is_write_authorized(auth.uid(), project_id)
      AND (
        (SELECT count(*) FROM memories m WHERE m.project_id = memories.project_id)
        < memory_limit_for_project(memories.project_id)
      )
    );
  ```
- **Tests:** Extend `e2e-tier-enforcement.test.ts` with a unit test for the function's return values (mock or SQLite: confirm free=10000, pro=50000, team=100000 at the TypeScript layer; the SQL function itself is tested via Supabase integration). Add a vitest test in a new `__tests__/memory-limits.test.ts` that mocks the Supabase client and verifies the policy name change does not break the server's remember tool error handling (the tool should still return a limit/upgrade message, not crash).
- **Depends on:** Task 1 (needs `projects.plan` column)
- **Pre-mortem:** If this fails, it will be because the old policy name in 0034 was already dropped or renamed by another migration. Use `DROP POLICY IF EXISTS` to guard.
- **Notes:** `SECURITY DEFINER` is required because RLS policies run as the calling user and cannot query `projects.plan` without it (same pattern as `is_pro()` in 0002). The subquery in the WITH CHECK counts memories before the insert, matching the behavior of the prior 0034 policy.

---

### Task 4: Migration 0046 — Seat limit enforcement

- **Files (create):** `supabase/migrations/0046_seat_limits.sql`
- **SQL:**
  ```sql
  CREATE OR REPLACE FUNCTION seat_limit_for_project(pid uuid)
  RETURNS integer AS $$
    SELECT CASE
      WHEN p.plan = 'team' THEN 25
      WHEN p.plan = 'pro'  THEN 5
      ELSE 2
    END
    FROM projects p WHERE p.id = pid;
  $$ LANGUAGE sql STABLE SECURITY DEFINER
     SET search_path = public, extensions;

  CREATE OR REPLACE FUNCTION check_seat_limit()
  RETURNS trigger AS $$
  BEGIN
    IF (
      SELECT COUNT(*)
      FROM team_members
      WHERE project_id = NEW.project_id AND status = 'active'
    ) >= seat_limit_for_project(NEW.project_id) THEN
      RAISE EXCEPTION 'Seat limit reached for this project plan';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER
     SET search_path = public, extensions;

  DROP TRIGGER IF EXISTS enforce_seat_limit ON team_members;

  CREATE TRIGGER enforce_seat_limit
    BEFORE INSERT ON team_members
    FOR EACH ROW
    WHEN (NEW.status = 'active')
    EXECUTE FUNCTION check_seat_limit();
  ```
- **Tests:** Add a vitest test in `__tests__/seat-limits.test.ts` that verifies:
  - `seat_limit_for_project` return values (mocked: free=2, pro=5, team=25)
  - The trigger fires on `status = 'active'` inserts only (pending inserts bypass it)
  - The RAISE EXCEPTION message matches `'Seat limit reached'` so the CLI can pattern-match it for a user-friendly error
  Note: trigger behavior requires Supabase; mark trigger tests as `.skip` with an integration note (same pattern used in `e2e-tier-enforcement.test.ts` Test 2 for the project limit).
- **Depends on:** Task 1, Task 2
- **Pre-mortem:** If this fails, it will be because `DROP TRIGGER IF EXISTS` is not supported in the target Postgres version, or because `WHEN (NEW.status = 'active')` in the trigger clause conflicts with an older Postgres version. Both are safe in Postgres 14+ which Supabase uses.
- **Notes:** The trigger counts only `status = 'active'` members, so pending invites do not consume seats (correct behavior — seat is consumed when invite is accepted in Phase 2).

---

### Task 5: Add `TEAM_TOOLS` to `tier-config.ts` and update `tier-gate.ts`

- **Files (modify):**
  - `packages/server/src/tier-config.ts`
  - `packages/server/src/tier-gate.ts`
- **Changes to `tier-config.ts`:**
  - Add `export const TEAM_TOOLS = ALL_TOOLS` (team gets all tools — same as pro for now)
  - No changes to `FREE_TOOLS` or `PRO_TOOLS` (existing tool counts must stay stable or `tier-config.test.ts` will fail)
- **Changes to `tier-gate.ts`:**
  - `gateCheck` already passes `'team'` through (the `effectivePlan !== 'free'` check). No logic change required.
  - Update the `UPGRADE_MSG` tool description line: it currently names Pro and Team but does not distinguish them. Leave as-is for Phase 1; Phase 2 will add team-specific messaging.
  - Document in a comment that `'team'` plan is treated identically to `'pro'` at the gate level.
- **Tests:** Extend `tier-config.test.ts`:
  - `TEAM_TOOLS` equals `ALL_TOOLS`
  - `gateCheck('team', 'memory_graph')` returns null (not blocked)
  - `gateCheck('team', 'remember')` returns null (not blocked)
  - `gateCheck(undefined, 'memory_graph')` still returns a GateResult (blocked — free tier)
- **Depends on:** nothing (pure TypeScript, no migration dependency)
- **Notes:** `TEAM_TOOLS` is typed as `typeof ALL_TOOLS` — do not create a new string array; assign by reference. This avoids any count drift that would break the existing `tier-config.test.ts` assertion (`FREE_TOOLS.length + PRO_TOOLS.length === 56`).

---

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| Task 1 | `supabase/migrations/0043_projects_plan_column.sql` | — |
| Task 2 | `supabase/migrations/0044_team_members_invite_columns.sql` | — |
| Task 3 | `supabase/migrations/0045_tier_aware_memory_limits.sql`, `packages/server/src/__tests__/memory-limits.test.ts` | `packages/server/src/__tests__/e2e-tier-enforcement.test.ts` |
| Task 4 | `supabase/migrations/0046_seat_limits.sql`, `packages/server/src/__tests__/seat-limits.test.ts` | — |
| Task 5 | — | `packages/server/src/tier-config.ts`, `packages/server/src/tier-gate.ts`, `packages/server/src/__tests__/tier-config.test.ts` |

No file conflicts. Each file appears in exactly one task.

---

## Open Questions

- [ ] **Does Supabase Postgres version support `ALTER COLUMN ... DROP NOT NULL` on a column with a composite UNIQUE constraint?** — Blocks: Task 2. Default if unresolved: drop the original `UNIQUE(project_id, user_id)` constraint, alter the column, then recreate as a partial unique index `WHERE user_id IS NOT NULL`. Who: Howler running Task 2.

- [ ] **Should `memory_limit_for_project` use `SECURITY DEFINER` or rely on the RLS context?** — Blocks: Task 3. Default if unresolved: use `SECURITY DEFINER` (consistent with `is_pro()`, `is_project_member()`, `is_write_authorized()` — all three use it). Who: no human escalation needed.

- [ ] **Do pro users get the 50,000 memory limit (up from 10,000 per 0034) or stay at 10,000?** — Blocks: Task 3 limit values. The spec says pro=50,000 but 0034 gives pro users unlimited (the old `is_pro()` bypass). If pro users were previously unlimited, the new 50,000 cap is a regression for existing pro customers. Default if unresolved: keep pro unlimited by replicating the old `is_pro()` bypass alongside the new function (add an `OR is_pro(auth.uid())` clause to the new policy). Who: product decision — requires human confirmation before Task 3 is written.

---

## Definition of Done

- [ ] All four migration files created and named correctly (0043–0046)
- [ ] `supabase db reset` (or `supabase migration up`) applies all migrations without errors on a local Supabase instance
- [ ] `pnpm --filter server test` passes with zero failures (521 existing + new tests)
- [ ] `pnpm typecheck` passes across all packages
- [ ] `projects.plan` column verified present in Supabase schema inspector
- [ ] `team_members.user_id` verified nullable in schema inspector
- [ ] `tier-config.test.ts` updated tests pass (TEAM_TOOLS assertions)
- [ ] New test files (`memory-limits.test.ts`, `seat-limits.test.ts`) added with appropriate skip annotations for Supabase-only tests
- [ ] Open Question 3 (pro memory limit regression) answered before Task 3 is merged
- [ ] PR opened on `team-rbac` branch with coverage gaps noted in description
