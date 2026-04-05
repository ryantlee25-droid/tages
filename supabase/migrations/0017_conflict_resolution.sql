-- ============================================================
-- Tages — Conflict Resolution
-- Tracks memory conflicts and their resolutions.
-- ============================================================

do $$ begin
  create type conflict_resolution_strategy as enum ('keep_newer', 'keep_older', 'merge');
exception when duplicate_object then null;
end $$;

create table if not exists memory_conflicts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  memory_a_id     uuid not null references memories(id) on delete cascade,
  memory_b_id     uuid not null references memories(id) on delete cascade,
  reason          text not null,
  resolved        boolean not null default false,
  resolution_strategy conflict_resolution_strategy,
  merged_value    text,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index memory_conflicts_project_idx on memory_conflicts(project_id);
create index memory_conflicts_unresolved_idx on memory_conflicts(project_id, resolved) where resolved = false;

-- RLS
alter table memory_conflicts enable row level security;

create policy "Members can read conflicts"
  on memory_conflicts for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert conflicts"
  on memory_conflicts for insert
  with check (is_project_member(auth.uid(), project_id));

create policy "Members can update conflicts"
  on memory_conflicts for update
  using (is_project_member(auth.uid(), project_id));

-- RPC: list unresolved conflicts
create or replace function list_unresolved_conflicts(p_project_id uuid)
returns table (
  id uuid,
  memory_a_id uuid,
  memory_b_id uuid,
  reason text,
  a_key text,
  a_value text,
  b_key text,
  b_value text,
  created_at timestamptz
) as $$
  select
    c.id,
    c.memory_a_id,
    c.memory_b_id,
    c.reason,
    a.key as a_key,
    a.value as a_value,
    b.key as b_key,
    b.value as b_value,
    c.created_at
  from memory_conflicts c
  join memories a on a.id = c.memory_a_id
  join memories b on b.id = c.memory_b_id
  where c.project_id = p_project_id
    and c.resolved = false
  order by c.created_at desc;
$$ language sql security definer stable;
