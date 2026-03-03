-- Phase 3-1: Workflow item state machine foundation

create table if not exists public.workflow_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in (
    'campaign_plan',
    'content_draft',
    'content_generation_request',
    'generic_approval'
  )),
  status text not null check (status in (
    'proposed',
    'revision_requested',
    'approved',
    'rejected'
  )) default 'proposed',
  payload jsonb not null default '{}'::jsonb,
  origin_chat_message_id uuid references public.chat_messages(id) on delete set null,
  source_campaign_id uuid references public.campaigns(id) on delete set null,
  source_content_id uuid references public.contents(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow_item_id uuid not null references public.workflow_items(id) on delete cascade,
  action text not null check (action in (
    'proposed',
    'request_revision',
    'resubmitted',
    'approved',
    'rejected'
  )),
  actor_type text not null check (actor_type in ('user', 'assistant', 'system')),
  actor_user_id uuid references public.users(id),
  from_status text,
  to_status text not null,
  payload jsonb not null default '{}'::jsonb,
  expected_version bigint,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create index if not exists idx_workflow_items_org_status_created
  on public.workflow_items (org_id, status, created_at desc);

create index if not exists idx_workflow_items_org_type_status_created
  on public.workflow_items (org_id, type, status, created_at desc);

create index if not exists idx_workflow_events_item_created
  on public.workflow_events (workflow_item_id, created_at asc);

create index if not exists idx_workflow_events_org_created
  on public.workflow_events (org_id, created_at desc);

create unique index if not exists idx_workflow_items_unique_campaign_source
  on public.workflow_items (source_campaign_id)
  where type = 'campaign_plan'
  and source_campaign_id is not null;

create unique index if not exists idx_workflow_items_unique_content_source
  on public.workflow_items (source_content_id)
  where type = 'content_draft'
  and source_content_id is not null;

drop trigger if exists workflow_items_updated_at on public.workflow_items;
create trigger workflow_items_updated_at
before update on public.workflow_items
for each row
execute function public.update_updated_at();

alter table public.workflow_items enable row level security;
alter table public.workflow_events enable row level security;

alter table public.workflow_items force row level security;
alter table public.workflow_events force row level security;

drop policy if exists "org members can manage workflow items" on public.workflow_items;
create policy "org members can manage workflow items"
  on public.workflow_items
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

drop policy if exists "org members can manage workflow events" on public.workflow_events;
create policy "org members can manage workflow events"
  on public.workflow_events
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
