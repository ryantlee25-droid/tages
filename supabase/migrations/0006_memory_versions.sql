-- ============================================================
-- Tages — Memory Versioning
-- Keeps history when memories are updated.
-- ============================================================

create table memory_versions (
  id          uuid primary key default gen_random_uuid(),
  memory_id   uuid not null references memories(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  key         text not null,
  value       text not null,
  type        text not null,
  source      text not null,
  confidence  real not null,
  version     int not null default 1,
  changed_by  text,               -- agent name or 'manual'
  change_reason text,             -- 'update', 'import', 'auto_index'
  created_at  timestamptz not null default now()
);

create index memory_versions_memory_idx on memory_versions(memory_id);
create index memory_versions_project_idx on memory_versions(project_id);

-- Trigger: auto-snapshot before update
create or replace function snapshot_memory_version()
returns trigger as $$
begin
  -- Only snapshot if value actually changed
  if old.value is distinct from new.value then
    insert into memory_versions (memory_id, project_id, key, value, type, source, confidence, version, changed_by, change_reason)
    values (
      old.id, old.project_id, old.key, old.value, old.type, old.source, old.confidence,
      coalesce((select max(version) from memory_versions where memory_id = old.id), 0) + 1,
      new.source,
      'update'
    );
  end if;
  return new;
end;
$$ language plpgsql;

create trigger memory_version_snapshot
  before update on memories
  for each row execute function snapshot_memory_version();

-- RPC: get version history for a memory
create or replace function memory_history(p_memory_id uuid)
returns table (
  version int,
  value text,
  changed_by text,
  change_reason text,
  created_at timestamptz
) as $$
  select version, value, changed_by, change_reason, created_at
  from memory_versions
  where memory_id = p_memory_id
  order by version desc;
$$ language sql security definer stable;

-- RLS
alter table memory_versions enable row level security;

create policy "Members can read version history"
  on memory_versions for select
  using (is_project_member(auth.uid(), project_id));
