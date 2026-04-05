-- ============================================================
-- Tages — Agent Session Tracking + Usage Analytics
-- Tracks which agents access which memories, session duration,
-- cross-agent correlation, and staleness signals.
-- ============================================================

-- -----------------------------------------------------------
-- agent_sessions — tracks each MCP/CLI session
-- -----------------------------------------------------------
create table agent_sessions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  agent_name  text not null,               -- 'claude-code', 'cursor', 'codex', 'cli', etc.
  agent_version text,                       -- e.g. '1.2.0'
  session_start timestamptz not null default now(),
  session_end   timestamptz,
  memories_recalled  int not null default 0,
  memories_stored    int not null default 0,
  memories_deleted   int not null default 0,
  recall_hits        int not null default 0, -- queries that returned results
  recall_misses      int not null default 0, -- queries with zero results
  created_at  timestamptz not null default now()
);

create index agent_sessions_project_id_idx on agent_sessions(project_id);
create index agent_sessions_agent_name_idx on agent_sessions(project_id, agent_name);
create index agent_sessions_start_idx on agent_sessions(session_start);

-- -----------------------------------------------------------
-- memory_access_log — per-memory access tracking
-- -----------------------------------------------------------
create table memory_access_log (
  id          uuid primary key default gen_random_uuid(),
  memory_id   uuid not null references memories(id) on delete cascade,
  session_id  uuid references agent_sessions(id) on delete set null,
  project_id  uuid not null references projects(id) on delete cascade,
  agent_name  text not null,
  access_type text not null check (access_type in (
    'recall', 'read', 'update', 'create', 'delete'
  )),
  query       text,                         -- the recall query that surfaced this memory
  similarity  real,                         -- trigram similarity score if from recall
  created_at  timestamptz not null default now()
);

create index memory_access_log_memory_idx on memory_access_log(memory_id);
create index memory_access_log_session_idx on memory_access_log(session_id);
create index memory_access_log_project_idx on memory_access_log(project_id, created_at);

-- -----------------------------------------------------------
-- memory_conflicts — detected contradictions between memories
-- -----------------------------------------------------------
create table memory_conflicts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  memory_a_id uuid not null references memories(id) on delete cascade,
  memory_b_id uuid not null references memories(id) on delete cascade,
  conflict_type text not null check (conflict_type in (
    'contradictory',  -- same topic, opposite advice
    'overlapping',    -- similar keys, different values
    'superseded'      -- newer memory makes older one stale
  )),
  description text,
  resolved    boolean not null default false,
  resolved_at timestamptz,
  detected_at timestamptz not null default now()
);

create index memory_conflicts_project_idx on memory_conflicts(project_id);
create index memory_conflicts_unresolved_idx on memory_conflicts(project_id)
  where resolved = false;

-- -----------------------------------------------------------
-- Staleness tracking — add to memories table
-- -----------------------------------------------------------
alter table memories add column last_accessed timestamptz;
alter table memories add column access_count int not null default 0;
alter table memories add column stale boolean not null default false;
alter table memories add column stale_reason text;

-- -----------------------------------------------------------
-- RPC: increment access count on a memory
-- -----------------------------------------------------------
create or replace function increment_access_count(p_memory_id uuid)
returns void as $$
  update memories
  set access_count = access_count + 1,
      last_accessed = now()
  where id = p_memory_id;
$$ language sql security definer;

-- -----------------------------------------------------------
-- RPC: mark stale memories (not accessed in 30 days, code may have changed)
-- -----------------------------------------------------------
create or replace function mark_stale_memories(p_project_id uuid)
returns int as $$
  with updated as (
    update memories
    set stale = true,
        stale_reason = 'Not accessed in 30+ days'
    where project_id = p_project_id
      and stale = false
      and (last_accessed is null or last_accessed < now() - interval '30 days')
      and created_at < now() - interval '30 days'
    returning id
  )
  select count(*)::int from updated;
$$ language sql security definer;

-- -----------------------------------------------------------
-- RPC: get usage stats for a project
-- -----------------------------------------------------------
create or replace function project_usage_stats(p_project_id uuid)
returns json as $$
  select json_build_object(
    'total_memories', (select count(*) from memories where project_id = p_project_id),
    'stale_memories', (select count(*) from memories where project_id = p_project_id and stale = true),
    'total_sessions', (select count(*) from agent_sessions where project_id = p_project_id),
    'total_recalls', (select coalesce(sum(memories_recalled), 0) from agent_sessions where project_id = p_project_id),
    'recall_hit_rate', (
      select case
        when coalesce(sum(recall_hits) + sum(recall_misses), 0) = 0 then 0
        else round(sum(recall_hits)::numeric / (sum(recall_hits) + sum(recall_misses))::numeric, 2)
      end
      from agent_sessions where project_id = p_project_id
    ),
    'agents', (
      select json_agg(json_build_object('name', agent_name, 'sessions', cnt, 'last_seen', last_seen))
      from (
        select agent_name, count(*) as cnt, max(session_start) as last_seen
        from agent_sessions where project_id = p_project_id
        group by agent_name order by cnt desc
      ) sub
    ),
    'most_accessed', (
      select json_agg(json_build_object('key', key, 'type', type, 'access_count', access_count))
      from (
        select key, type, access_count from memories
        where project_id = p_project_id and access_count > 0
        order by access_count desc limit 10
      ) sub
    ),
    'never_accessed', (
      select count(*) from memories
      where project_id = p_project_id and access_count = 0
        and created_at < now() - interval '7 days'
    )
  );
$$ language sql security definer stable;

-- -----------------------------------------------------------
-- RPC: detect overlapping memories (potential conflicts)
-- -----------------------------------------------------------
create or replace function detect_memory_conflicts(p_project_id uuid)
returns table (
  memory_a_id uuid,
  memory_a_key text,
  memory_b_id uuid,
  memory_b_key text,
  key_similarity real
) as $$
begin
  return query
    select
      a.id as memory_a_id, a.key as memory_a_key,
      b.id as memory_b_id, b.key as memory_b_key,
      similarity(a.key, b.key) as key_similarity
    from memories a
    join memories b on a.project_id = b.project_id
      and a.id < b.id
      and similarity(a.key, b.key) > 0.5
    where a.project_id = p_project_id
    order by key_similarity desc
    limit 20;
end;
$$ language plpgsql security definer stable;

-- -----------------------------------------------------------
-- RLS for new tables
-- -----------------------------------------------------------
alter table agent_sessions enable row level security;
alter table memory_access_log enable row level security;
alter table memory_conflicts enable row level security;

create policy "Members can read sessions"
  on agent_sessions for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert sessions"
  on agent_sessions for insert
  with check (is_project_member(auth.uid(), project_id));

create policy "Members can update sessions"
  on agent_sessions for update
  using (is_project_member(auth.uid(), project_id));

create policy "Members can read access log"
  on memory_access_log for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can insert access log"
  on memory_access_log for insert
  with check (is_project_member(auth.uid(), project_id));

create policy "Members can read conflicts"
  on memory_conflicts for select
  using (is_project_member(auth.uid(), project_id));

create policy "Members can manage conflicts"
  on memory_conflicts for insert
  with check (is_project_member(auth.uid(), project_id));

create policy "Members can resolve conflicts"
  on memory_conflicts for update
  using (is_project_member(auth.uid(), project_id));
