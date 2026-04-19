-- Migration 0055: invite expiry column + expiry guard in accept_pending_invites
-- Adds a 30-day default expiry to team_members pending rows, and teaches the
-- accept RPC to skip expired pending rows.

-- 1. Add expires_at column (nullable; NULL = no expiry) with 30-day default
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    DEFAULT (now() + interval '30 days');

-- 2. Backfill existing pending rows so they pick up the default
UPDATE team_members
   SET expires_at = now() + interval '30 days'
 WHERE status = 'pending'
   AND expires_at IS NULL;

-- 3. Replace the accept RPC to reject expired pending rows
CREATE OR REPLACE FUNCTION accept_pending_invites(user_email text, uid uuid)
RETURNS integer AS $$
  WITH updated AS (
    UPDATE team_members
       SET user_id = uid,
           status  = 'active'
     WHERE email = user_email
       AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > now())
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM updated;
$$ LANGUAGE sql SECURITY DEFINER
   SET search_path = public, extensions;

-- 4. Re-issue grant (CREATE OR REPLACE does not reliably preserve it)
GRANT EXECUTE ON FUNCTION accept_pending_invites(text, uuid) TO authenticated;
