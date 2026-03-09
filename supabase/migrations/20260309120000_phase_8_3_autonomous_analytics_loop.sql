-- Phase 8-3: autonomous analytics loop

create table if not exists public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_reason text not null check (trigger_reason in ('new_metrics', 'cadence', 'manual', 'recovery')),
  summary text not null,
  key_actions jsonb not null default '[]'::jsonb,
  markdown text not null,
  markdown_hash text not null,
  content_count integer not null check (content_count >= 0),
  model_used text not null,
  compared_report_ids jsonb not null default '[]'::jsonb,
  export_path text,
  exported_at timestamptz,
  analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analysis_reports_org_date
  on public.analysis_reports (org_id, analyzed_at desc);

create index if not exists idx_analysis_reports_org_hash
  on public.analysis_reports (org_id, markdown_hash);

drop trigger if exists analysis_reports_updated_at on public.analysis_reports;
create trigger analysis_reports_updated_at
before update on public.analysis_reports
for each row execute function public.update_updated_at();

create table if not exists public.analytics_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_reason text not null check (trigger_reason in ('new_metrics', 'cadence', 'manual', 'recovery')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  idempotency_key text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  metric_high_watermark timestamptz,
  report_id uuid references public.analysis_reports(id) on delete set null,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_analytics_analysis_runs_org_idempotency
  on public.analytics_analysis_runs (org_id, idempotency_key);

create index if not exists idx_analytics_analysis_runs_dispatch
  on public.analytics_analysis_runs (status, requested_at, lease_expires_at)
  where status in ('queued', 'running');

drop trigger if exists analytics_analysis_runs_updated_at on public.analytics_analysis_runs;
create trigger analytics_analysis_runs_updated_at
before update on public.analytics_analysis_runs
for each row execute function public.update_updated_at();

alter table public.org_rag_embeddings
  drop constraint if exists org_rag_embeddings_source_type_check;

alter table public.org_rag_embeddings
  add constraint org_rag_embeddings_source_type_check
  check (source_type in (
    'brand_profile', 'content', 'local_doc', 'chat_pattern', 'analysis_report'
  ));

alter table public.analysis_reports enable row level security;
alter table public.analysis_reports force row level security;

drop policy if exists "org members can read analysis reports" on public.analysis_reports;
create policy "org members can read analysis reports"
  on public.analysis_reports
  for select
  using (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );

drop policy if exists "service role can manage analysis reports" on public.analysis_reports;
create policy "service role can manage analysis reports"
  on public.analysis_reports
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.analytics_analysis_runs enable row level security;
alter table public.analytics_analysis_runs force row level security;

drop policy if exists "service role can manage analytics analysis runs" on public.analytics_analysis_runs;
create policy "service role can manage analytics analysis runs"
  on public.analytics_analysis_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
