create table sso_configs (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  domain        text not null unique,
  metadata_url  text,
  metadata_xml  text,
  provider_id   text,
  enabled       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table sso_configs enable row level security;
create policy "Owner can manage their SSO config"
  on sso_configs for all
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());
