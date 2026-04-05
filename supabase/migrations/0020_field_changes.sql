-- Migration: 0020_field_changes
-- Track field-level changes per memory version

CREATE TABLE IF NOT EXISTS field_changes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  version_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  change_type TEXT NOT NULL CHECK (change_type IN ('added', 'removed', 'modified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fc_version_id ON field_changes(version_id);
CREATE INDEX IF NOT EXISTS fc_memory_id ON field_changes(memory_id);
CREATE INDEX IF NOT EXISTS fc_project_field ON field_changes(project_id, field_name);

COMMENT ON TABLE field_changes IS
  'Field-level diff records per memory version — enables showing what changed, not just full snapshots';
