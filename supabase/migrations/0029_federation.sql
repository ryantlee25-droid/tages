-- XL7: Federated memory library
CREATE TABLE IF NOT EXISTS federated_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  memory_data JSONB NOT NULL,
  scope TEXT NOT NULL DEFAULT 'org' CHECK (scope IN ('org', 'team', 'public')),
  version INTEGER NOT NULL DEFAULT 1,
  promoted_by UUID REFERENCES auth.users(id),
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (memory_key, version)
);

CREATE INDEX IF NOT EXISTS idx_federated_key ON federated_memories(memory_key);
CREATE INDEX IF NOT EXISTS idx_federated_scope ON federated_memories(scope);
CREATE INDEX IF NOT EXISTS idx_federated_owner ON federated_memories(owner_project_id);

-- Local overrides of federated memories
CREATE TABLE IF NOT EXISTS federated_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  federated_key TEXT NOT NULL,
  local_memory_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, federated_key)
);

CREATE INDEX IF NOT EXISTS idx_federated_overrides_project ON federated_overrides(project_id);

ALTER TABLE federated_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE federated_overrides ENABLE ROW LEVEL SECURITY;

-- Public federated memories are visible to all authenticated users
CREATE POLICY "federated_select" ON federated_memories
  FOR SELECT USING (
    scope = 'public' OR
    owner_project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "federated_write" ON federated_memories
  FOR INSERT WITH CHECK (
    owner_project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "federated_overrides_access" ON federated_overrides
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
