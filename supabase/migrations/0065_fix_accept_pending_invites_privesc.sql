-- ============================================================
-- Tages — Fix privilege escalation in accept_pending_invites (0065)
--
-- VULNERABILITY (introduced 0047, carried forward by 0055):
--   accept_pending_invites(user_email text, uid uuid) is SECURITY DEFINER
--   and granted to `authenticated`, but BOTH parameters are caller-supplied
--   with no binding to the session. Any authenticated user could call
--     select accept_pending_invites('victim@company.com', '<their own uid>')
--   to claim someone else's pending invite and gain full read access to that
--   project's memories. Signup is open GitHub OAuth, so this was exploitable
--   by anyone who could create an account.
--
-- FIX:
--   Drop the two-argument signature entirely (it must not remain callable —
--   that is the whole point) and replace it with a zero-argument function
--   that derives identity internally from the verified JWT: auth.uid() for
--   the user id and auth.jwt() ->> 'email' for the address. The caller can
--   no longer name a victim, only accept invites addressed to itself.
--
-- Also fixed here: email is now matched case-insensitively. The dashboard
-- invite route normalizes with email.trim().toLowerCase() on write
-- (apps/dashboard/src/app/api/projects/[id]/invite/route.ts), but the old
-- function compared raw, so a mixed-case JWT email silently matched nothing.
--
-- SECURITY DEFINER is preserved deliberately: the function must bypass the
-- "Owners can update team members" UPDATE policy from 0051 so an invitee can
-- flip their own pending row to active. Identity is now bound to the session,
-- so definer rights are no longer a spoofing vector.
--
-- `set search_path = public, extensions` is required on every recreated
-- function in this repo (see 0042): pgvector's `vector` type lives in the
-- `extensions` schema. auth.uid() / auth.jwt() are schema-qualified, so they
-- resolve regardless of search_path.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Remove the vulnerable signature
-- ----------------------------------------------------------------
DROP FUNCTION IF EXISTS accept_pending_invites(text, uuid);

-- ----------------------------------------------------------------
-- 2. Session-bound replacement — no caller-supplied identity
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_pending_invites()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid   uuid    := auth.uid();
  v_email text    := auth.jwt() ->> 'email';
  v_count integer;
BEGIN
  -- Unauthenticated or emailless caller: match nothing, return 0.
  -- Without this guard a NULL v_uid would still be written into user_id.
  IF v_uid IS NULL OR v_email IS NULL OR btrim(v_email) = '' THEN
    RETURN 0;
  END IF;

  WITH updated AS (
    UPDATE team_members
       SET user_id = v_uid,
           status  = 'active'
     WHERE lower(email) = lower(v_email)
       AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > now())
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

-- ----------------------------------------------------------------
-- 3. Grant (CREATE OR REPLACE does not reliably preserve grants)
-- ----------------------------------------------------------------
GRANT EXECUTE ON FUNCTION accept_pending_invites() TO authenticated;
