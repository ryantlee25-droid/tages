-- ============================================================
-- Tages — Initial Schema
-- 5 tables: projects, memories, decision_log,
--           architecture_snapshots, team_members
-- Plus user_profiles for Pro tier tracking
-- ============================================================

-- Enable required extensions
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------
-- projects
-- -----------------------------------------------------------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  git_remote  text,
  default_branch text not null default 'main',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index projects_owner_id_idx on projects(owner_id);
create index projects_slug_idx on projects(slug);

-- -----------------------------------------------------------
-- memories
-- -----------------------------------------------------------
create table memories (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  key         text not null,
  value       text not null,
  type        text not null check (type in (
                'convention', 'decision', 'architecture',
                'entity', 'lesson', 'preference', 'pattern'
              )),
  source      text not null default 'manual' check (source in (
                'manual', 'auto_index', 'agent', 'import'
              )),
  agent_name  text,
  file_paths  text[] default '{}',
  tags        text[] default '{}',
  confidence  real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index memories_project_id_idx on memories(project_id);
create index memories_type_idx on memories(project_id, type);

-- Unique constraint: no duplicate keys per project
create unique index memories_project_key_uniq on memories(project_id, key);

-- -----------------------------------------------------------
-- decision_log
-- -----------------------------------------------------------
create table decision_log (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  decision        text not null,
  rationale       text,
  files_affected  text[] default '{}',
  agent_name      text,
  commit_sha      text,
  created_at      timestamptz not null default now()
);

create index decision_log_project_id_idx on decision_log(project_id);

-- -----------------------------------------------------------
-- architecture_snapshots
-- -----------------------------------------------------------
create table architecture_snapshots (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  snapshot    jsonb not null,
  commit_sha  text,
  created_at  timestamptz not null default now()
);

create index architecture_snapshots_project_id_idx on architecture_snapshots(project_id);

-- -----------------------------------------------------------
-- team_members
-- -----------------------------------------------------------
create table team_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at  timestamptz not null default now(),

  unique(project_id, user_id)
);

create index team_members_project_id_idx on team_members(project_id);
create index team_members_user_id_idx on team_members(user_id);

-- -----------------------------------------------------------
-- user_profiles (Pro tier tracking)
-- -----------------------------------------------------------
create table user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  is_pro      boolean not null default false,
  pro_since   timestamptz
);

-- -----------------------------------------------------------
-- updated_at trigger function
-- -----------------------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

create trigger memories_updated_at
  before update on memories
  for each row execute function update_updated_at();
