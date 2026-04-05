-- XL4: Memory quality score cache
CREATE TABLE IF NOT EXISTS quality_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  total_score INTEGER NOT NULL DEFAULT 0,
  completeness_score INTEGER NOT NULL DEFAULT 0,
  freshness_score INTEGER NOT NULL DEFAULT 0,
  consistency_score INTEGER NOT NULL DEFAULT 0,
  usefulness_score INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_quality_project ON quality_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_score ON quality_scores(project_id, total_score);

ALTER TABLE quality_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_scores_access" ON quality_scores
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
