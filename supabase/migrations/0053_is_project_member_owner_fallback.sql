-- Migration 0053: Restore project-owner fallback in is_project_member
-- Regression introduced by 0051: when adding the `status='active'` filter
-- to prevent revoked members from accessing data, the OR-branch that
-- allowed project OWNERS (not in team_members) was dropped. Project
-- owners therefore failed is_project_member, breaking memories/
-- decision_log/architecture_snapshots RLS (all three rely on
-- is_project_member as the sole read check).
-- This migration restores the owner fallback while keeping the
-- status='active' filter on the team_members path.

CREATE OR REPLACE FUNCTION is_project_member(uid uuid, pid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS(
    SELECT 1 FROM team_members
    WHERE user_id = uid
      AND project_id = pid
      AND status = 'active'
  )
  OR EXISTS(
    SELECT 1 FROM projects
    WHERE id = pid
      AND owner_id = uid
  );
$$;
