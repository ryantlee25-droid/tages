-- XL6: Memory archive (cold storage)
CREATE TABLE IF NOT EXISTS memory_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  memory_data JSONB NOT NULL,  -- full snapshot of the archived memory
  archive_reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_archive_project ON memory_archive(project_id);
CREATE INDEX IF NOT EXISTS idx_archive_key ON memory_archive(project_id, memory_key);
CREATE INDEX IF NOT EXISTS idx_archive_expires ON memory_archive(expires_at) WHERE expires_at IS NOT NULL;

-- Archive-level statistics per project
CREATE TABLE IF NOT EXISTS archive_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  total_archived INTEGER NOT NULL DEFAULT 0,
  total_restored INTEGER NOT NULL DEFAULT 0,
  total_expired INTEGER NOT NULL DEFAULT 0,
  last_archive_at TIMESTAMPTZ,
  last_restore_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archive_stats_project ON archive_stats(project_id);

ALTER TABLE memory_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "archive_access" ON memory_archive
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "archive_stats_access" ON archive_stats
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
