-- Phase 1-6b: onboarding brand review + interview synthesis persistence

create table if not exists public.org_brand_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  website_url text,
  naver_blog_url text,
  instagram_url text,
  facebook_url text,
  youtube_url text,
  threads_url text,
  crawl_status jsonb not null default '{}'::jsonb,
  crawl_payload jsonb not null default '{}'::jsonb,
  interview_answers jsonb not null default '{}'::jsonb,
  detected_tone text,
  tone_description text,
  target_audience jsonb not null default '[]'::jsonb,
  key_themes jsonb not null default '[]'::jsonb,
  forbidden_words jsonb not null default '[]'::jsonb,
  forbidden_topics jsonb not null default '[]'::jsonb,
  campaign_seasons jsonb not null default '[]'::jsonb,
  brand_summary text,
  result_document jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

drop trigger if exists org_brand_settings_updated_at on public.org_brand_settings;
create trigger org_brand_settings_updated_at
before update on public.org_brand_settings
for each row
execute function public.update_updated_at();

create index if not exists idx_org_brand_settings_org_id
  on public.org_brand_settings (org_id);

alter table public.org_brand_settings enable row level security;
alter table public.org_brand_settings force row level security;

drop policy if exists "org members can manage brand settings" on public.org_brand_settings;
create policy "org members can manage brand settings"
  on public.org_brand_settings
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

