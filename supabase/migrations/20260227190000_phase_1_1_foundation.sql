-- Phase 1-1 foundation schema
-- Re-runnable migration for local and CI environments.

create extension if not exists pgcrypto;

-- =====================
-- ORGANIZATIONS
-- =====================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_type text not null check (org_type in ('ngo', 'nonprofit', 'social_venture', 'social_enterprise')),
  description text,
  website text,
  created_at timestamptz not null default now()
);

-- =====================
-- USERS
-- =====================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  telegram_id text unique,
  created_at timestamptz not null default now()
);

-- =====================
-- ORGANIZATION MEMBERS
-- =====================
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- =====================
-- CONTENTS
-- =====================
create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'facebook', 'youtube')),
  content_type text not null check (content_type in ('text', 'image', 'video')),
  status text not null check (status in ('draft', 'pending_approval', 'approved', 'published', 'rejected')) default 'draft',
  body text,
  metadata jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by text not null check (created_by in ('ai', 'user')),
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================
-- LOCAL FILES
-- =====================
create table if not exists public.local_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null check (file_type in ('image', 'video', 'document')),
  file_size bigint,
  thumbnail_url text,
  metadata jsonb not null default '{}'::jsonb,
  indexed_at timestamptz not null default now()
);

-- =====================
-- CHAT MESSAGES
-- =====================
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  channel text not null check (channel in ('dashboard', 'telegram')),
  created_at timestamptz not null default now()
);

-- updated_at trigger for contents
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contents_updated_at on public.contents;
create trigger contents_updated_at
before update on public.contents
for each row
execute function public.update_updated_at();

-- =====================
-- INDEXES
-- =====================
create index if not exists idx_organization_members_user_org
  on public.organization_members (user_id, org_id);

create index if not exists idx_contents_org_created_at
  on public.contents (org_id, created_at desc);

create index if not exists idx_contents_org_status
  on public.contents (org_id, status);

create index if not exists idx_local_files_org_indexed_at
  on public.local_files (org_id, indexed_at desc);

create index if not exists idx_chat_messages_org_created_at
  on public.chat_messages (org_id, created_at desc);

-- =====================
-- RLS
-- =====================
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.organization_members enable row level security;
alter table public.contents enable row level security;
alter table public.local_files enable row level security;
alter table public.chat_messages enable row level security;

alter table public.organizations force row level security;
alter table public.users force row level security;
alter table public.organization_members force row level security;
alter table public.contents force row level security;
alter table public.local_files force row level security;
alter table public.chat_messages force row level security;

-- users

drop policy if exists "users can view own profile" on public.users;
create policy "users can view own profile"
  on public.users
  for select
  using (id = auth.uid());

drop policy if exists "users can insert own profile" on public.users;
create policy "users can insert own profile"
  on public.users
  for insert
  with check (id = auth.uid());

drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile"
  on public.users
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- organizations

drop policy if exists "org members can view organization" on public.organizations;
create policy "org members can view organization"
  on public.organizations
  for select
  using (
    id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );

-- organization_members

drop policy if exists "members can view own memberships" on public.organization_members;
create policy "members can view own memberships"
  on public.organization_members
  for select
  using (user_id = auth.uid());

-- contents

drop policy if exists "org members can manage contents" on public.contents;
create policy "org members can manage contents"
  on public.contents
  for all
  using (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  )
  with check (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );

-- local_files

drop policy if exists "org members can manage local files" on public.local_files;
create policy "org members can manage local files"
  on public.local_files
  for all
  using (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  )
  with check (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );

-- chat_messages

drop policy if exists "org members can manage chat messages" on public.chat_messages;
create policy "org members can manage chat messages"
  on public.chat_messages
  for all
  using (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  )
  with check (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );
