-- Phase 1-5a: backend orchestration schema
-- Adds campaigns/session persistence and trigger processing metadata.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  activity_folder text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'active', 'completed', 'cancelled')),
  channels jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists campaigns_updated_at on public.campaigns;
create trigger campaigns_updated_at
before update on public.campaigns
for each row
execute function public.update_updated_at();

create index if not exists idx_campaigns_org_status
  on public.campaigns (org_id, status);

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;

drop policy if exists "org members can manage campaigns" on public.campaigns;
create policy "org members can manage campaigns"
  on public.campaigns
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

alter table public.contents
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create index if not exists idx_contents_org_campaign
  on public.contents (org_id, campaign_id);

alter table public.pipeline_triggers
  add column if not exists processed_at timestamptz;

create table if not exists public.orchestrator_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_id uuid references public.pipeline_triggers(id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  current_step text not null default 'detect'
    check (current_step in (
      'detect',
      'await_user_input',
      'await_campaign_approval',
      'generate_content',
      'await_content_approval',
      'publish',
      'done'
    )),
  status text not null default 'running'
    check (status in ('running', 'paused', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists orchestrator_sessions_updated_at on public.orchestrator_sessions;
create trigger orchestrator_sessions_updated_at
before update on public.orchestrator_sessions
for each row
execute function public.update_updated_at();

create unique index if not exists uq_orchestrator_sessions_org_active
  on public.orchestrator_sessions (org_id)
  where status in ('running', 'paused');

create index if not exists idx_orchestrator_sessions_org_updated
  on public.orchestrator_sessions (org_id, updated_at desc);

alter table public.orchestrator_sessions enable row level security;
alter table public.orchestrator_sessions force row level security;

drop policy if exists "org members can manage sessions" on public.orchestrator_sessions;
create policy "org members can manage sessions"
  on public.orchestrator_sessions
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

