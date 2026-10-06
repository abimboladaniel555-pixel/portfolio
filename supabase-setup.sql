-- Run ONCE in Supabase: SQL Editor -> New query -> paste everything -> Run

-- 1) Contact form messages
create table if not exists messages (
  id          bigint generated always as identity primary key,
  name        text not null,
  email       text not null,
  service     text,
  message     text not null,
  created_at  timestamptz not null default now()
);
alter table messages enable row level security;

-- 2) Content you edit in /admin
create table if not exists site_content (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table site_content enable row level security;
