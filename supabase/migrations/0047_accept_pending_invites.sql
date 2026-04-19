-- Migration 0047: Auto-accept pending invites when a user authenticates
-- Called from MCP server startup after session is restored.
-- Matches pending team_members rows by email, sets user_id and status='active'.

CREATE OR REPLACE FUNCTION accept_pending_invites(user_email text, uid uuid)
RETURNS integer AS $$
  WITH updated AS (
    UPDATE team_members
    SET user_id = uid, status = 'active'
    WHERE email = user_email AND status = 'pending'
    RETURNING id
  )
  SELECT COUNT(*)::integer FROM updated;
$$ LANGUAGE sql SECURITY DEFINER
   SET search_path = public, extensions;

-- Grant execute to authenticated users (needed for RPC calls)
GRANT EXECUTE ON FUNCTION accept_pending_invites(text, uuid) TO authenticated;
