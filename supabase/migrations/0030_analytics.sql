-- XL8: Agent behavior analytics
CREATE TABLE IF NOT EXISTS tool_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  agent_name TEXT,
  tool_name TEXT NOT NULL,
  args JSONB,
  result_summary TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_call_project ON tool_call_log(project_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_session ON tool_call_log(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_agent ON tool_call_log(project_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_tool_call_created ON tool_call_log(project_id, created_at DESC);

-- Per-session aggregated metrics
CREATE TABLE IF NOT EXISTS session_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  agent_name TEXT,
  total_calls INTEGER NOT NULL DEFAULT 0,
  recall_hits INTEGER NOT NULL DEFAULT 0,
  recall_misses INTEGER NOT NULL DEFAULT 0,
  memories_created INTEGER NOT NULL DEFAULT 0,
  memories_updated INTEGER NOT NULL DEFAULT 0,
  convention_violations INTEGER NOT NULL DEFAULT 0,
  recall_hit_rate NUMERIC(5, 4),
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_metrics_project ON session_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_session_metrics_agent ON session_metrics(project_id, agent_name);

-- Cached agent-level metrics for dashboard
CREATE TABLE IF NOT EXISTS agent_metrics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  avg_recall_hit_rate NUMERIC(5, 4),
  total_memories_created INTEGER NOT NULL DEFAULT 0,
  total_violations INTEGER NOT NULL DEFAULT 0,
  overall_score INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, agent_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_project ON agent_metrics_cache(project_id);

ALTER TABLE tool_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_metrics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tool_call_log_access" ON tool_call_log
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "session_metrics_access" ON session_metrics
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "agent_metrics_cache_access" ON agent_metrics_cache
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
