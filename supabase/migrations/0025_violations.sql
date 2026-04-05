-- XL3: Convention violations tracking
CREATE TABLE IF NOT EXISTS convention_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  convention_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('violation', 'warning')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_project ON convention_violations(project_id);
CREATE INDEX IF NOT EXISTS idx_violations_agent ON convention_violations(project_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_violations_created ON convention_violations(project_id, created_at DESC);

-- Enforcement reports cache
CREATE TABLE IF NOT EXISTS enforcement_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_violations INTEGER NOT NULL DEFAULT 0,
  total_warnings INTEGER NOT NULL DEFAULT 0,
  agent_scores JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enforcement_project ON enforcement_reports(project_id);

ALTER TABLE convention_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "violations_access" ON convention_violations
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "enforcement_reports_access" ON enforcement_reports
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
