-- Add 'session_context' memory type for temporary Session Continuity Memory (SCM)
alter table memories drop constraint if exists memories_type_check;
alter table memories add constraint memories_type_check
  check (type in (
    'convention', 'decision', 'architecture',
    'entity', 'lesson', 'preference', 'pattern', 'execution',
    'operational', 'environment', 'anti_pattern', 'session_context'
  ));
