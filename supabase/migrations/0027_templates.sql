-- XL5: Memory templates
CREATE TABLE IF NOT EXISTS memory_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = built-in global template
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  memory_type TEXT NOT NULL,
  file_patterns JSONB NOT NULL DEFAULT '[]',
  fields JSONB NOT NULL DEFAULT '[]',
  key_prefix TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_templates_project ON memory_templates(project_id);

-- Track which templates have been filled and how many times
CREATE TABLE IF NOT EXISTS template_fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_fills_project ON template_fills(project_id);
CREATE INDEX IF NOT EXISTS idx_template_fills_template ON template_fills(project_id, template_id);

ALTER TABLE memory_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_fills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select" ON memory_templates
  FOR SELECT USING (
    project_id IS NULL OR  -- built-in templates are global
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "templates_write" ON memory_templates
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "template_fills_access" ON template_fills
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
