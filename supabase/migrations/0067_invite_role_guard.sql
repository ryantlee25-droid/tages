-- ============================================================
-- Tages — Invite role guard: block privilege escalation via team_members (0067)
--
-- VULNERABILITY:
--   `tages team invite --role owner` accepted 'owner'
--   (packages/cli/src/commands/team.ts), contradicting both the command's own
--   help text ("Role: member or admin") and the dashboard invite route, which
--   rejects anything but member/admin and further restricts granting 'admin'
--   to project owners only
--   (apps/dashboard/src/app/api/projects/[id]/invite/route.ts:37,86).
--
--   The RLS layer did not close the gap. The "Admins can invite team members"
--   INSERT policy from 0051(b) checks only the CALLER's role — it never looks
--   at the role being granted (NEW.role). Net effect: any active admin could
--   mint another owner, either through the CLI or by POSTing to PostgREST
--   directly with their own JWT.
--
-- FIX:
--   A BEFORE INSERT OR UPDATE row trigger on team_members that inspects the
--   role being granted, not just the grantor. Modelled on the seat-limit
--   trigger from 0051(d) (check_seat_limit_on_update /
--   enforce_seat_limit_update) so the enforcement style stays consistent.
--
--   A trigger is the right enforcement point rather than tightening the RLS
--   WITH CHECK, because the dashboard performs its invite INSERT with the
--   SERVICE ROLE key (route.ts:159-179 getAdminClient). Service role bypasses
--   RLS entirely, so an RLS-only fix would leave the dashboard path unguarded
--   while a trigger still fires. Triggers also cover UPDATE uniformly, whereas
--   the UPDATE policy from 0051(c) and the INSERT policy from 0051(b) would
--   each have needed separate, divergent edits.
--
-- RULES ENFORCED (only for sessions bound to an end user — see exemption):
--   - granting role 'owner' requires owner-level authority
--   - granting role 'admin' requires owner-level authority (matches the
--     dashboard's "Only project owners can invite admins", route.ts:86)
--   - granting role 'member' is unchanged — 0051(b) already limits INSERT to
--     active owners/admins, and 0051(c) limits UPDATE to project owners
--
-- DELIBERATE EXEMPTION — auth.uid() IS NULL:
--   When no end-user identity is bound to the session the trigger allows the
--   write. This is required, not an oversight:
--     * service_role (the dashboard backend) carries no `sub` claim, so
--       auth.uid() is NULL. Enforcing here would break the legitimate
--       owner-invites-admin path, since route.ts has already authorized the
--       caller in application code before switching to the admin client.
--     * the `anon` role also has a NULL auth.uid(), but every team_members
--       INSERT/UPDATE policy (0051 b and c) requires auth.uid() to match an
--       owner/admin row, so RLS rejects anon writes before this trigger is
--       reached. The exemption opens no anonymous path.
--     * migrations, psql and other superuser sessions stay unblocked.
--   The attack this migration closes runs as `authenticated` with a real
--   auth.uid(), which is exactly the case that IS enforced.
--
-- MUST NOT BREAK — accept_pending_invites (0065):
--   That function is SECURITY DEFINER and flips a pending row to
--   status='active' while setting user_id. auth.uid() is still the invitee
--   (it reads the session JWT GUC, which SECURITY DEFINER does not change),
--   and the invitee is not an owner. The row's role is NOT modified by that
--   UPDATE, so the guard below short-circuits on
--   `OLD.role IS NOT DISTINCT FROM NEW.role` and the accept still succeeds —
--   including for a pending row whose role is already 'admin'. This is why the
--   UPDATE branch keys off a role CHANGE rather than the role VALUE.
--
-- OUT OF SCOPE (unchanged): demoting an existing owner. 0051(c) already
--   restricts UPDATE on team_members to the project owner.
--
-- `set search_path = public, extensions` appears both at session level and as
-- a per-function attribute, per the repo rule from 0042 — pgvector's `vector`
-- type lives in the `extensions` schema, and migration #69 broke production by
-- omitting it. auth.uid() is schema-qualified and resolves regardless.
-- ============================================================

set search_path = public, extensions;

-- ----------------------------------------------------------------
-- 1. Guard function
--    CREATE OR REPLACE (never DROP): dropping a function with live
--    callers loses its EXECUTE grants. New name, no collision with
--    check_seat_limit (0046) or check_seat_limit_on_update (0051).
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_team_member_role_grant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_owner boolean;
BEGIN
  -- On UPDATE, only police an actual role change. A status/user_id-only
  -- update (accept_pending_invites, revoke, seat bookkeeping) passes through.
  -- Nested IF, not a compound AND: OLD is unassigned during INSERT and
  -- referencing OLD.role in the same expression would error before the
  -- TG_OP test could short-circuit.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 'member' is the floor privilege; who may write at all is already
  -- constrained by the RLS policies from 0051.
  IF NEW.role = 'member' THEN
    RETURN NEW;
  END IF;

  -- No end-user identity bound to this session (service_role backend,
  -- migration, psql). See the DELIBERATE EXEMPTION note in the header.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owner-level authority: the project owner, or an active 'owner' row in
  -- team_members. Mirrors the shape used by 0051(b) and is_write_authorized.
  SELECT (
    EXISTS(
      SELECT 1 FROM projects p
      WHERE p.id = NEW.project_id
        AND p.owner_id = v_uid
    )
    OR EXISTS(
      SELECT 1 FROM team_members tm
      WHERE tm.project_id = NEW.project_id
        AND tm.user_id = v_uid
        AND tm.role = 'owner'
        AND tm.status = 'active'
    )
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION
      'Only project owners can grant the % role', NEW.role
      USING ERRCODE = '42501',
            HINT = 'Admins may invite members only. Ask a project owner to grant owner or admin.';
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------
-- 2. Trigger (idempotent)
--    Separate from enforce_seat_limit / enforce_seat_limit_update so both
--    keep working. BEFORE row triggers fire in name order, so this one runs
--    first ('r' < 's') and an escalation attempt is rejected before the
--    seat-limit check — both are pure guards, so order is not load-bearing.
-- ----------------------------------------------------------------
DROP TRIGGER IF EXISTS enforce_role_grant_authority ON team_members;
CREATE TRIGGER enforce_role_grant_authority
  BEFORE INSERT OR UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION check_team_member_role_grant();
