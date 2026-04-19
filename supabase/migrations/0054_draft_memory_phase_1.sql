-- Migration 0054: Draft Memory Phase 1 — schema + RLS fixes for pending memory capture
-- All statements are idempotent.

-- ============================================================
-- a. Extend memories.status CHECK constraint to allow 'archived'
--    Status lifecycle: pending -> live -> archived
-- ============================================================

ALTER TABLE memories DROP CONSTRAINT IF EXISTS memories_status_check;
ALTER TABLE memories ADD CONSTRAINT memories_status_check
  CHECK (status IN ('live', 'pending', 'archived'));

-- ============================================================
-- b & c. Replace tier-aware INSERT policy (originally from 0045)
--    Fix: pending memories no longer count against the live quota.
--    Add: independent pending cap (Free=100, Pro=1000, Team=2000).
--    Archived inserts are unrestricted by count (archiving is a move, not a new entry).
-- ============================================================

-- Helper function: pending memory cap per tier
CREATE OR REPLACE FUNCTION pending_memory_limit_for_project(pid uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT
      CASE up.plan
        WHEN 'team' THEN 2000
        WHEN 'pro'  THEN 1000
        ELSE 100
      END
     FROM user_profiles up
     WHERE up.user_id = (SELECT owner_id FROM projects WHERE id = pid)),
    100
  );
$$;

-- Drop old policy (from migration 0045)
DROP POLICY IF EXISTS "Write-authorized users can insert memories (tier-aware limit)" ON memories;

-- New combined policy: enforces live quota + pending cap independently
CREATE POLICY "Write-authorized users can insert memories (tier-aware limit)"
  ON memories FOR INSERT
  WITH CHECK (
    is_write_authorized(auth.uid(), project_id)
    AND (
      (memories.status = 'live' AND
       (SELECT COUNT(*) FROM memories m
        WHERE m.project_id = memories.project_id AND m.status = 'live')
       < memory_limit_for_project(memories.project_id))
      OR
      (memories.status = 'pending' AND
       (SELECT COUNT(*) FROM memories m
        WHERE m.project_id = memories.project_id AND m.status = 'pending')
       < pending_memory_limit_for_project(memories.project_id))
      OR
      memories.status = 'archived'
    )
  );

-- ============================================================
-- d. Add auto_save_threshold column to projects
--    NULL = opt-in disabled (review-required, default per Q3 decision).
--    0.0–1.0 = auto-promote pending memories >= threshold at session_end.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS auto_save_threshold real
    CHECK (auto_save_threshold IS NULL OR (auto_save_threshold >= 0 AND auto_save_threshold <= 1));
