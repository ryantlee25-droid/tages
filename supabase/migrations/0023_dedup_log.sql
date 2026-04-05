-- XL1: Deduplication audit log
CREATE TABLE IF NOT EXISTS dedup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  survivor_key TEXT NOT NULL,
  victim_key TEXT NOT NULL,
  merge_note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dedup_log_project ON dedup_log(project_id);
CREATE INDEX IF NOT EXISTS idx_dedup_log_survivor ON dedup_log(project_id, survivor_key);

-- Row-level security
ALTER TABLE dedup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dedup_log_select" ON dedup_log
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "dedup_log_insert" ON dedup_log
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
