-- Phase 8-1: Performance analytics feedback loop foundation

create table if not exists public.content_metrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'threads', 'naver_blog', 'facebook', 'youtube')),
  likes integer check (likes is null or likes >= 0),
  comments integer check (comments is null or comments >= 0),
  shares integer check (shares is null or shares >= 0),
  saves integer check (saves is null or saves >= 0),
  follower_delta integer,
  performance_score numeric(5,2) check (performance_score is null or (performance_score >= 0 and performance_score <= 100)),
  collection_source text not null default 'manual' check (
    collection_source = 'manual'
    or collection_source like 'api_%'
  ),
  idempotency_key text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_content_metrics_org_content_collected
  on public.content_metrics (org_id, content_id, collected_at desc);

create index if not exists idx_content_metrics_org_channel_collected
  on public.content_metrics (org_id, channel, collected_at desc);

create index if not exists idx_content_metrics_org_score
  on public.content_metrics (org_id, performance_score desc)
  where performance_score is not null;

create unique index if not exists uq_content_metrics_org_idempotency
  on public.content_metrics (org_id, idempotency_key);

alter table public.content_metrics enable row level security;
alter table public.content_metrics force row level security;

drop policy if exists "service role can manage content metrics" on public.content_metrics;
create policy "service role can manage content metrics"
  on public.content_metrics
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
