-- Migration: 0018_auto_merge
-- Add merge_base_value column to memory_conflicts for 3-way merge support

ALTER TABLE memory_conflicts
  ADD COLUMN IF NOT EXISTS merge_base_value TEXT;

COMMENT ON COLUMN memory_conflicts.merge_base_value IS
  'Snapshot of the memory value at conflict detection time (used as base for 3-way merge)';
