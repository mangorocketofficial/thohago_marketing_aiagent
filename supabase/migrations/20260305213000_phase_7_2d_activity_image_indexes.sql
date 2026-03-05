-- Phase 7-2d: Vision-based image index table for deterministic instagram image selection.

create table if not exists public.activity_image_indexes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_id text not null,
  activity_folder text not null,
  file_name text not null,
  file_size_bytes bigint,
  file_modified_at timestamptz,
  file_content_hash text not null,
  status text not null default 'ready' check (status in ('ready', 'failed', 'deleted')),
  last_error text,
  vision_model text,
  schema_version text,
  summary_text text,
  objects_json jsonb not null default '[]'::jsonb,
  scene_tags text[] not null default '{}'::text[],
  ocr_text text,
  ocr_language text,
  safety_json jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  is_latest boolean not null default true,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_activity_image_indexes_org_source_hash
  on public.activity_image_indexes (org_id, source_id, file_content_hash);

create index if not exists idx_activity_image_indexes_selector_folder
  on public.activity_image_indexes (org_id, activity_folder, is_latest, status, file_modified_at desc);

create index if not exists idx_activity_image_indexes_selector_org
  on public.activity_image_indexes (org_id, is_latest, status, file_modified_at desc);

create index if not exists idx_activity_image_indexes_source_latest
  on public.activity_image_indexes (org_id, source_id, is_latest);

drop trigger if exists activity_image_indexes_updated_at on public.activity_image_indexes;
create trigger activity_image_indexes_updated_at
before update on public.activity_image_indexes
for each row execute function public.update_updated_at();

alter table public.activity_image_indexes enable row level security;
alter table public.activity_image_indexes force row level security;

drop policy if exists "org members can manage activity image indexes" on public.activity_image_indexes;
create policy "org members can manage activity image indexes"
  on public.activity_image_indexes
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
