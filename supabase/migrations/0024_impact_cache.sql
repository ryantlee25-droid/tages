-- XL2: Impact score cache (materialized via periodic refresh)
CREATE TABLE IF NOT EXISTS impact_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  direct_dependent_count INTEGER NOT NULL DEFAULT 0,
  transitive_count INTEGER NOT NULL DEFAULT 0,
  risk_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_impact_project ON impact_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_impact_risk ON impact_scores(project_id, risk_level, risk_score DESC);

ALTER TABLE impact_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "impact_scores_select" ON impact_scores
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "impact_scores_write" ON impact_scores
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
