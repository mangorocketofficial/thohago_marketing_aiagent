-- Phase 6-2 foundation
-- 1) Scheduler slot model (Option B)
-- 2) Campaign plan audit/version history store
-- 3) Scheduler job lock/idempotency foundation

-- =====================
-- schedule_slots
-- =====================
create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  workflow_item_id uuid references public.workflow_items(id) on delete set null,
  content_id uuid references public.contents(id) on delete set null,
  session_id uuid references public.orchestrator_sessions(id) on delete set null,
  channel text not null,
  content_type text not null check (content_type in ('text', 'image', 'video')),
  title text,
  scheduled_date date not null,
  scheduled_time timestamptz,
  slot_status text not null default 'scheduled' check (
    slot_status in (
      'scheduled',
      'generating',
      'pending_approval',
      'approved',
      'published',
      'skipped',
      'failed'
    )
  ),
  generation_lead_minutes integer not null default 120 check (generation_lead_minutes >= 0),
  metadata jsonb not null default '{}'::jsonb,
  lock_version integer not null default 1 check (lock_version >= 1),
  processing_lease_owner text,
  processing_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_schedule_slots_org_date
  on public.schedule_slots (org_id, scheduled_date, created_at desc);

create index if not exists idx_schedule_slots_org_status_date
  on public.schedule_slots (org_id, slot_status, scheduled_date, created_at desc);

create index if not exists idx_schedule_slots_campaign
  on public.schedule_slots (campaign_id, scheduled_date);

create index if not exists idx_schedule_slots_content
  on public.schedule_slots (content_id)
  where content_id is not null;

create index if not exists idx_schedule_slots_workflow
  on public.schedule_slots (workflow_item_id)
  where workflow_item_id is not null;

create index if not exists idx_schedule_slots_lease_expiry
  on public.schedule_slots (processing_lease_expires_at)
  where processing_lease_expires_at is not null;

create unique index if not exists uq_schedule_slots_content_unique
  on public.schedule_slots (content_id)
  where content_id is not null;

drop trigger if exists schedule_slots_updated_at on public.schedule_slots;
create trigger schedule_slots_updated_at
before update on public.schedule_slots
for each row
execute function public.update_updated_at();

-- =====================
-- campaign_plan_versions
-- =====================
create table if not exists public.campaign_plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.orchestrator_sessions(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  draft_version integer not null check (draft_version >= 1),
  source text not null check (source in ('draft_generated', 'revision_generated', 'finalized')),
  activity_folder text not null default '',
  user_message text,
  revision_reason text,
  plan jsonb not null,
  plan_document text,
  plan_chain_data jsonb,
  plan_summary jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_campaign_plan_versions_org_created
  on public.campaign_plan_versions (org_id, created_at desc);

create index if not exists idx_campaign_plan_versions_campaign_draft
  on public.campaign_plan_versions (campaign_id, draft_version desc, created_at desc);

create index if not exists idx_campaign_plan_versions_session
  on public.campaign_plan_versions (session_id, created_at desc)
  where session_id is not null;

create unique index if not exists uq_campaign_plan_versions_source_key
  on public.campaign_plan_versions (
    org_id,
    coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    draft_version,
    source
  );

drop trigger if exists campaign_plan_versions_updated_at on public.campaign_plan_versions;
create trigger campaign_plan_versions_updated_at
before update on public.campaign_plan_versions
for each row
execute function public.update_updated_at();

-- =====================
-- scheduler_jobs
-- =====================
create table if not exists public.scheduler_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  slot_id uuid not null references public.schedule_slots(id) on delete cascade,
  job_type text not null check (job_type in ('generate', 'publish')),
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_scheduler_jobs_org_idempotency
  on public.scheduler_jobs (org_id, idempotency_key);

create index if not exists idx_scheduler_jobs_dispatch
  on public.scheduler_jobs (status, run_after, lease_expires_at)
  where status in ('queued', 'running');

create index if not exists idx_scheduler_jobs_slot
  on public.scheduler_jobs (slot_id, created_at desc);

drop trigger if exists scheduler_jobs_updated_at on public.scheduler_jobs;
create trigger scheduler_jobs_updated_at
before update on public.scheduler_jobs
for each row
execute function public.update_updated_at();

-- =====================
-- RLS
-- =====================
alter table public.schedule_slots enable row level security;
alter table public.schedule_slots force row level security;

alter table public.campaign_plan_versions enable row level security;
alter table public.campaign_plan_versions force row level security;

alter table public.scheduler_jobs enable row level security;
alter table public.scheduler_jobs force row level security;

drop policy if exists "org members can manage schedule slots" on public.schedule_slots;
create policy "org members can manage schedule slots"
  on public.schedule_slots
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

drop policy if exists "org members can manage campaign plan versions" on public.campaign_plan_versions;
create policy "org members can manage campaign plan versions"
  on public.campaign_plan_versions
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

drop policy if exists "org members can manage scheduler jobs" on public.scheduler_jobs;
create policy "org members can manage scheduler jobs"
  on public.scheduler_jobs
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
