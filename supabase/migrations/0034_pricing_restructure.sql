-- ============================================================
-- Tages — Pricing Restructure
-- Free tier: 500 → 10,000 memories per project
-- Pro tier: unlimited (no cap)
-- Project limit unchanged (free: 1, pro: unlimited)
-- ============================================================

-- Drop the old memory insert policy (from 0031 RBAC migration)
DROP POLICY IF EXISTS "Write-authorized users can insert memories (free: max 500)" ON memories;

-- Recreate with 10,000 limit for free tier
CREATE POLICY "Write-authorized users can insert memories (free: max 10000)"
  ON memories FOR INSERT
  WITH CHECK (
    is_write_authorized(auth.uid(), project_id)
    AND (
      is_pro(auth.uid())
      OR (SELECT count(*) FROM memories m WHERE m.project_id = memories.project_id) < 10000
    )
  );
