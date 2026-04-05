-- ============================================================
-- Tages — API Tokens for CI/CD
-- Long-lived tokens for headless indexing (GitHub Actions, etc.)
-- ============================================================

create table api_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null unique,
  name        text not null default 'default',
  created_at  timestamptz not null default now(),
  last_used   timestamptz
);

create index api_tokens_user_id_idx on api_tokens(user_id);
create index api_tokens_hash_idx on api_tokens(token_hash);

alter table api_tokens enable row level security;

create policy "Users can read own tokens"
  on api_tokens for select
  using (user_id = auth.uid());

create policy "Users can create tokens"
  on api_tokens for insert
  with check (user_id = auth.uid());

create policy "Users can delete own tokens"
  on api_tokens for delete
  using (user_id = auth.uid());
