-- Migration: 0022_session_branches
-- Session memory branching: fork/merge memories per session

CREATE TABLE IF NOT EXISTS memory_branches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mb_session_id ON memory_branches(session_id);
CREATE INDEX IF NOT EXISTS mb_project_id ON memory_branches(project_id);

CREATE TABLE IF NOT EXISTS branch_memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  memory_data JSONB NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, memory_key)
);

CREATE INDEX IF NOT EXISTS bm_session_id ON branch_memories(session_id);
CREATE INDEX IF NOT EXISTS bm_project_session ON branch_memories(project_id, session_id);

COMMENT ON TABLE memory_branches IS 'Session branch metadata — each session can fork an independent memory workspace';
COMMENT ON TABLE branch_memories IS 'Per-session memory snapshots for branched workspaces';
