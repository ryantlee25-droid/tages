-- ============================================================
-- Tages — Full-Audit Hardening (0052)
-- Covers: encrypted column, federation RLS, SECURITY DEFINER
-- access guards, auth_audit_log export event type.
-- All statements are idempotent.
-- ============================================================

-- ----------------------------------------------------------------
-- C1: Add `encrypted` column to memories
-- ----------------------------------------------------------------
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------
-- C2: UPDATE + DELETE policies for federated_memories
-- ----------------------------------------------------------------
DROP POLICY IF EXISTS "Members can update federated memories" ON federated_memories;
CREATE POLICY "Members can update federated memories"
  ON federated_memories FOR UPDATE
  USING (
    owner_project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "Members can delete federated memories" ON federated_memories;
CREATE POLICY "Members can delete federated memories"
  ON federated_memories FOR DELETE
  USING (
    owner_project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner','admin')
    )
  );

-- C2: UPDATE + DELETE policies for federated_overrides
-- federated_overrides already has a FOR ALL policy; add explicit UPDATE + DELETE scoped to owners/admins.
DROP POLICY IF EXISTS "Members can update federated overrides" ON federated_overrides;
CREATE POLICY "Members can update federated overrides"
  ON federated_overrides FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "Members can delete federated overrides" ON federated_overrides;
CREATE POLICY "Members can delete federated overrides"
  ON federated_overrides FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members
      WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner','admin')
    )
  );

-- ----------------------------------------------------------------
-- C3: Add access guards to SECURITY DEFINER functions (migration 0005)
-- ----------------------------------------------------------------

-- project_usage_stats
CREATE OR REPLACE FUNCTION project_usage_stats(p_project_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (
    EXISTS(SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid())
    OR is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN (
    SELECT json_build_object(
      'total_memories', (SELECT count(*) FROM memories WHERE project_id = p_project_id),
      'stale_memories', (SELECT count(*) FROM memories WHERE project_id = p_project_id AND stale = true),
      'total_sessions', (SELECT count(*) FROM agent_sessions WHERE project_id = p_project_id),
      'total_recalls', (SELECT coalesce(sum(memories_recalled), 0) FROM agent_sessions WHERE project_id = p_project_id),
      'recall_hit_rate', (
        SELECT CASE
          WHEN coalesce(sum(recall_hits) + sum(recall_misses), 0) = 0 THEN 0
          ELSE round(sum(recall_hits)::numeric / (sum(recall_hits) + sum(recall_misses))::numeric, 2)
        END
        FROM agent_sessions WHERE project_id = p_project_id
      ),
      'agents', (
        SELECT json_agg(json_build_object('name', agent_name, 'sessions', cnt, 'last_seen', last_seen))
        FROM (
          SELECT agent_name, count(*) AS cnt, max(session_start) AS last_seen
          FROM agent_sessions WHERE project_id = p_project_id
          GROUP BY agent_name ORDER BY cnt DESC
        ) sub
      ),
      'most_accessed', (
        SELECT json_agg(json_build_object('key', key, 'type', type, 'access_count', access_count))
        FROM (
          SELECT key, type, access_count FROM memories
          WHERE project_id = p_project_id AND access_count > 0
          ORDER BY access_count DESC LIMIT 10
        ) sub
      ),
      'never_accessed', (
        SELECT count(*) FROM memories
        WHERE project_id = p_project_id AND access_count = 0
          AND created_at < now() - interval '7 days'
      )
    )
  );
END;
$$;

-- mark_stale_memories
CREATE OR REPLACE FUNCTION mark_stale_memories(p_project_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT (
    EXISTS(SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid())
    OR is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  WITH updated AS (
    UPDATE memories
    SET stale = true,
        stale_reason = 'Not accessed in 30+ days'
    WHERE project_id = p_project_id
      AND stale = false
      AND (last_accessed IS NULL OR last_accessed < now() - interval '30 days')
      AND created_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*)::int INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

-- increment_access_count
CREATE OR REPLACE FUNCTION increment_access_count(p_memory_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id FROM memories WHERE id = p_memory_id;

  IF v_project_id IS NULL THEN
    RETURN; -- memory not found, silently no-op
  END IF;

  IF NOT (
    EXISTS(SELECT 1 FROM projects WHERE id = v_project_id AND owner_id = auth.uid())
    OR is_project_member(auth.uid(), v_project_id)
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE memories
  SET access_count = access_count + 1,
      last_accessed = now()
  WHERE id = p_memory_id;
END;
$$;

-- detect_memory_conflicts
CREATE OR REPLACE FUNCTION detect_memory_conflicts(p_project_id uuid)
RETURNS TABLE (
  memory_a_id uuid,
  memory_a_key text,
  memory_b_id uuid,
  memory_b_key text,
  key_similarity real
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (
    EXISTS(SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid())
    OR is_project_member(auth.uid(), p_project_id)
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      a.id AS memory_a_id, a.key AS memory_a_key,
      b.id AS memory_b_id, b.key AS memory_b_key,
      similarity(a.key, b.key) AS key_similarity
    FROM memories a
    JOIN memories b ON a.project_id = b.project_id
      AND a.id < b.id
      AND similarity(a.key, b.key) > 0.5
    WHERE a.project_id = p_project_id
    ORDER BY key_similarity DESC
    LIMIT 20;
END;
$$;

-- ----------------------------------------------------------------
-- M1: Add 'export' event type to auth_audit_log CHECK constraint
-- ----------------------------------------------------------------
-- Drop and re-add the constraint to include 'export'.
ALTER TABLE auth_audit_log
  DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;

ALTER TABLE auth_audit_log
  ADD CONSTRAINT auth_audit_log_event_type_check
  CHECK (event_type IN ('login_success', 'login_failed', 'token_invalid', 'token_expired', 'export'));
