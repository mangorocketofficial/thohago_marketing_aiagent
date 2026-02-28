-- Phase 1-4: pipeline trigger inbox for secure server-side orchestration.

create table if not exists public.pipeline_triggers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  relative_path text not null,
  file_name text not null,
  activity_folder text not null,
  file_type text not null check (file_type in ('image', 'video', 'document')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  source_event_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_pipeline_triggers_org_source_event_id
  on public.pipeline_triggers (org_id, source_event_id)
  where source_event_id is not null;

create index if not exists idx_pipeline_triggers_org_status_created_at
  on public.pipeline_triggers (org_id, status, created_at);

alter table public.pipeline_triggers enable row level security;
alter table public.pipeline_triggers force row level security;

drop policy if exists "org members can manage pipeline triggers" on public.pipeline_triggers;
create policy "org members can manage pipeline triggers"
  on public.pipeline_triggers
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
