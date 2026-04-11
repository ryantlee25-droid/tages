export const FREE_TOOLS: readonly string[] = [
  'remember', 'recall', 'forget',
  'conventions', 'architecture', 'decisions',
  'context', 'staleness', 'conflicts', 'stats',
  'observe', 'session_end', 'verify_memory', 'pending_memories',
  'pre_check', 'project_brief', 'file_recall',
  'import_claude_md', 'import_memories',
  'memory_history',
] as const

export const PRO_TOOLS: readonly string[] = [
  'memory_stats_detail', 'contextual_recall',
  'resolve_conflict', 'list_conflicts',
  'suggestions', 'memory_graph',
  'fork_branch', 'merge_branch', 'list_branches',
  'detect_duplicates', 'consolidate_memories',
  'impact_analysis', 'risk_report', 'graph_analysis',
  'check_convention', 'enforcement_report',
  'memory_quality', 'project_health',
  'list_templates', 'match_templates', 'apply_template',
  'archive_memory', 'restore_memory', 'list_archived', 'archive_stats', 'auto_archive',
  'federate_memory', 'import_federated', 'list_federated', 'federation_overrides',
  'session_replay', 'agent_metrics', 'trends',
  'memory_audit', 'sharpen_memory', 'post_session',
] as const

export const ALL_TOOLS = [...FREE_TOOLS, ...PRO_TOOLS] as const

/** Team tier gets all tools (same as Pro for now — placeholder for team-specific tools later) */
export const TEAM_TOOLS = ALL_TOOLS
