-- Migration 0056: RLS DELETE policy for revoking pending invites
-- Owners and active admins can DELETE pending team_members rows so invites
-- can be revoked before acceptance. Active members still cannot be deleted;
-- the existing revoke path (status='revoked') handles those.
--
-- Preserves the owner-fallback lesson from 0053: project owners do not need
-- an entry in team_members to manage membership.

DROP POLICY IF EXISTS "Owner and admins can revoke pending invites" ON team_members;

CREATE POLICY "Owner and admins can revoke pending invites"
  ON team_members FOR DELETE
  USING (
    status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM projects p
         WHERE p.id = team_members.project_id
           AND p.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM team_members tm
         WHERE tm.project_id = team_members.project_id
           AND tm.user_id    = auth.uid()
           AND tm.role       = 'admin'
           AND tm.status     = 'active'
      )
    )
  );
