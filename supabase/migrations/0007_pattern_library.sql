-- ============================================================
-- Tages — Cross-Project Pattern Library
-- Shared conventions that apply across repos.
-- ============================================================

create table pattern_library (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  value       text not null,
  type        text not null check (type in (
    'convention', 'decision', 'architecture',
    'entity', 'lesson', 'preference', 'pattern'
  )),
  tags        text[] default '{}',
  usage_count int not null default 1,      -- how many projects use this
  source_projects text[] default '{}',     -- project slugs where this was seen
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique(owner_id, key)
);

create index pattern_library_owner_idx on pattern_library(owner_id);
create index pattern_library_type_idx on pattern_library(owner_id, type);

-- Trigger: updated_at
create trigger pattern_library_updated_at
  before update on pattern_library
  for each row execute function update_updated_at();

-- RPC: detect patterns that appear in multiple projects
create or replace function detect_shared_patterns(p_user_id uuid)
returns table (
  key text,
  value text,
  type text,
  project_count bigint,
  projects text[]
) as $$
  select
    m.key,
    m.value,
    m.type,
    count(distinct m.project_id) as project_count,
    array_agg(distinct p.slug) as projects
  from memories m
  join projects p on m.project_id = p.id
  where p.owner_id = p_user_id
  group by m.key, m.value, m.type
  having count(distinct m.project_id) > 1
  order by project_count desc
  limit 50;
$$ language sql security definer stable;

-- RPC: promote a memory to the pattern library
create or replace function promote_to_library(
  p_user_id uuid,
  p_key text,
  p_value text,
  p_type text,
  p_source_project text
)
returns uuid as $$
declare
  v_id uuid;
begin
  insert into pattern_library (owner_id, key, value, type, source_projects)
  values (p_user_id, p_key, p_value, p_type, array[p_source_project])
  on conflict (owner_id, key) do update
    set usage_count = pattern_library.usage_count + 1,
        source_projects = array_append(
          array_remove(pattern_library.source_projects, p_source_project),
          p_source_project
        ),
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$ language plpgsql security definer;

-- RLS
alter table pattern_library enable row level security;

create policy "Users can read own patterns"
  on pattern_library for select
  using (owner_id = auth.uid());

create policy "Users can manage own patterns"
  on pattern_library for insert
  with check (owner_id = auth.uid());

create policy "Users can update own patterns"
  on pattern_library for update
  using (owner_id = auth.uid());

create policy "Users can delete own patterns"
  on pattern_library for delete
  using (owner_id = auth.uid());
