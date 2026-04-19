-- ============================================================
-- Tages — Team RBAC Hardening (0051)
--
-- Seven changes from the pre-launch RBAC/RLS audit:
--
-- a. (C2) Fix is_project_member to exclude revoked/pending members
--         — only 'active' status grants access
-- b. (C1) Add INSERT RLS policy so admins can also invite team members
--         (previously only project owners could)
-- c. (C4) Add UPDATE RLS policy on team_members — owners only
--         — closes privilege-escalation: any member could UPDATE any row
-- d. (C3) Add BEFORE UPDATE trigger to enforce seat limit when a row
--         transitions to 'active' (e.g. invite accepted)
-- e. (M3) Fix seat_limit_for_project NULL handling — COALESCE to 2
--         when no user_profiles row exists for the project owner
-- f. (H3) Add caller-access checks to list_unresolved_conflicts and
--         get_memory_authors — previously any authenticated user could
--         query any project's data by guessing the project UUID
-- ============================================================

-- ----------------------------------------------------------------
-- a. Fix is_project_member to exclude revoked/pending members (C2)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_project_member(uid uuid, pid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS(
    SELECT 1 FROM team_members
    WHERE user_id = uid AND project_id = pid AND status = 'active'
  );
$$;

-- ----------------------------------------------------------------
-- b. Add INSERT RLS policy for admins on team_members (C1)
--    (The existing "Owners can manage team" INSERT policy is preserved;
--    RLS uses OR across policies for the same action.)
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can invite team members" ON team_members;
CREATE POLICY "Admins can invite team members"
  ON team_members FOR INSERT
  WITH CHECK (
    EXISTS(
      SELECT 1 FROM team_members tm
      WHERE tm.project_id = team_members.project_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
        AND tm.status = 'active'
    )
    OR EXISTS(
      SELECT 1 FROM projects p
      WHERE p.id = team_members.project_id AND p.owner_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- c. Add UPDATE RLS policy on team_members — owners only (C4)
--    Note: accept_pending_invites (migration 0047) is SECURITY DEFINER
--    and runs as postgres, so it bypasses RLS unaffected.
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can update team members" ON team_members;
CREATE POLICY "Owners can update team members"
  ON team_members FOR UPDATE
  USING (
    EXISTS(SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid())
  );

-- ----------------------------------------------------------------
-- d. BEFORE UPDATE trigger for seat limit on status → active (C3)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_seat_limit_on_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.status = 'active' AND (OLD.status IS NULL OR OLD.status <> 'active') THEN
    IF (
      SELECT COUNT(*) FROM team_members
      WHERE project_id = NEW.project_id AND status = 'active'
    ) >= seat_limit_for_project(NEW.project_id) THEN
      RAISE EXCEPTION 'Seat limit reached for this project plan';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_seat_limit_update ON team_members;
CREATE TRIGGER enforce_seat_limit_update
  BEFORE UPDATE ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION check_seat_limit_on_update();

-- ----------------------------------------------------------------
-- e. Fix seat_limit_for_project NULL handling (M3)
--    Uses subscription_quantity for team plans (capped at 20),
--    falls back to 2 (free tier) when no user_profiles row exists.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION seat_limit_for_project(pid uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT
      CASE up.plan
        WHEN 'team' THEN LEAST(COALESCE(up.subscription_quantity, 1), 20)
        WHEN 'pro'  THEN 5
        ELSE 2
      END
     FROM user_profiles up
     WHERE up.user_id = (SELECT owner_id FROM projects WHERE id = pid)),
    2
  );
$$;

-- ----------------------------------------------------------------
-- f. Add access guards to RPCs from migration 0048 (H3)
--    list_unresolved_conflicts — returns empty if caller has no access
--    get_memory_authors        — filters to memories caller can access
-- ----------------------------------------------------------------

DROP FUNCTION IF EXISTS list_unresolved_conflicts(uuid);
CREATE FUNCTION list_unresolved_conflicts(p_project_id uuid)
RETURNS TABLE (
  id uuid, memory_a_id uuid, memory_b_id uuid, reason text,
  a_key text, a_value text, b_key text, b_value text,
  a_updated_by text, b_updated_by text,
  a_updated_at timestamptz, b_updated_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, extensions
AS $$
BEGIN
  -- Verify caller has access to the project
  IF NOT EXISTS(
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND (p.owner_id = auth.uid() OR is_project_member(auth.uid(), p.id))
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.memory_a_id, c.memory_b_id, c.reason,
    a.key, a.value, b.key, b.value,
    COALESCE(ua.raw_user_meta_data->>'full_name', split_part(ua.email, '@', 1), 'Unknown'),
    COALESCE(ub.raw_user_meta_data->>'full_name', split_part(ub.email, '@', 1), 'Unknown'),
    a.updated_at, b.updated_at, c.created_at
  FROM memory_conflicts c
  JOIN memories a ON a.id = c.memory_a_id
  JOIN memories b ON b.id = c.memory_b_id
  LEFT JOIN auth.users ua ON ua.id = a.updated_by
  LEFT JOIN auth.users ub ON ub.id = b.updated_by
  WHERE c.project_id = p_project_id AND c.resolved = false
  ORDER BY c.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION list_unresolved_conflicts(uuid) TO authenticated;

DROP FUNCTION IF EXISTS get_memory_authors(uuid[]);
CREATE FUNCTION get_memory_authors(memory_ids uuid[])
RETURNS TABLE (memory_id uuid, display_name text, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Unknown'),
    m.updated_at
  FROM memories m
  LEFT JOIN auth.users u ON u.id = m.updated_by
  JOIN projects p ON p.id = m.project_id
  WHERE m.id = ANY(memory_ids)
    AND (p.owner_id = auth.uid() OR is_project_member(auth.uid(), p.id));
$$;

GRANT EXECUTE ON FUNCTION get_memory_authors(uuid[]) TO authenticated;
