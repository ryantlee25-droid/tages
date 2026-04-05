-- Migration: 0019_multi_hop_recall
-- Add depth parameter to contextual_recall RPC for multi-hop graph traversal

-- Drop and recreate contextual_recall RPC with optional depth parameter
DROP FUNCTION IF EXISTS contextual_recall(text, text, text, text[], text, integer);

CREATE OR REPLACE FUNCTION contextual_recall(
  p_project_id TEXT,
  p_query TEXT,
  p_type TEXT DEFAULT NULL,
  p_current_files TEXT[] DEFAULT NULL,
  p_phase TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 5,
  p_depth INTEGER DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  project_id TEXT,
  key TEXT,
  value TEXT,
  type TEXT,
  source TEXT,
  status TEXT,
  agent_name TEXT,
  file_paths TEXT[],
  tags TEXT[],
  confidence REAL,
  conditions TEXT[],
  phases TEXT[],
  cross_system_refs TEXT[],
  examples JSONB,
  execution_flow JSONB,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.project_id, m.key, m.value, m.type, m.source, m.status,
    m.agent_name, m.file_paths, m.tags, m.confidence,
    m.conditions, m.phases, m.cross_system_refs,
    m.examples, m.execution_flow, m.verified_at,
    m.created_at, m.updated_at
  FROM memories m
  WHERE m.project_id = p_project_id
    AND m.status = 'live'
    AND (
      p_query = '' OR p_query IS NULL
      OR m.key ILIKE '%' || p_query || '%'
      OR m.value ILIKE '%' || p_query || '%'
    )
    AND (p_type IS NULL OR m.type = p_type)
    AND (p_phase IS NULL OR p_phase = ANY(m.phases))
    AND (
      p_current_files IS NULL
      OR m.file_paths && p_current_files
      OR m.conditions && p_current_files
    )
  ORDER BY m.updated_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION contextual_recall IS
  'Context-filtered recall with optional multi-hop depth (depth handled in application layer via expandRecall)';
