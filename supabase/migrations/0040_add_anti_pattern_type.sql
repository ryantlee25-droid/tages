-- Add 'anti_pattern' memory type (was in Zod schema + TypeScript but missing from DB constraint)
alter table memories drop constraint if exists memories_type_check;
alter table memories add constraint memories_type_check
  check (type in (
    'convention', 'decision', 'architecture',
    'entity', 'lesson', 'preference', 'pattern', 'execution',
    'operational', 'environment', 'anti_pattern'
  ));
