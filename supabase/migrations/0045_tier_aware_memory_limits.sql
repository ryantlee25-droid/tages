-- Migration 0045: Replace hard-coded memory limit with tier-aware function
-- Free: 10,000 | Pro: 50,000 | Team: 100,000

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
