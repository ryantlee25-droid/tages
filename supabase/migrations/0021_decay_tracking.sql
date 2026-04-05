-- Migration: 0021_decay_tracking
-- Add access tracking columns and archive_memories RPC for confidence decay

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS memories_last_accessed ON memories(project_id, last_accessed_at)
  WHERE status = 'live';

CREATE INDEX IF NOT EXISTS memories_access_count ON memories(project_id, access_count);

-- RPC: archive stale memories below a threshold
CREATE OR REPLACE FUNCTION archive_memories(
  p_project_id TEXT,
  p_older_than_days INTEGER DEFAULT 180,
  p_max_access_count INTEGER DEFAULT 2
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  UPDATE memories
  SET status = 'archived',
      updated_at = now()
  WHERE project_id = p_project_id::uuid
    AND status = 'live'
    AND (
      last_accessed_at IS NULL
      OR last_accessed_at < now() - (p_older_than_days || ' days')::INTERVAL
    )
    AND updated_at < now() - (p_older_than_days || ' days')::INTERVAL
    AND access_count <= p_max_access_count;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;

-- RPC: increment access count and update last_accessed_at
CREATE OR REPLACE FUNCTION touch_memory_access(p_memory_id TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE memories
  SET last_accessed_at = now(),
      access_count = access_count + 1
  WHERE id = p_memory_id::uuid;
$$;

COMMENT ON COLUMN memories.last_accessed_at IS 'When this memory was last returned in a recall result';
COMMENT ON COLUMN memories.access_count IS 'Total number of recall accesses — used for decay scoring';
