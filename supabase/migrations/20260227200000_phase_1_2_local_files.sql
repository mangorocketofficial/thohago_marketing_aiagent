-- Phase 1-2 local files extension
-- Adds activity context, soft-delete status, and conflict-safe uniqueness.

alter table public.local_files
  add column if not exists activity_folder text not null default '';

alter table public.local_files
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'local_files_status_check'
      and conrelid = 'public.local_files'::regclass
  ) then
    alter table public.local_files
      add constraint local_files_status_check
      check (status in ('active', 'deleted'));
  end if;
end
$$;

create unique index if not exists uq_local_files_org_file_path
  on public.local_files (org_id, file_path);

create index if not exists idx_local_files_org_activity_folder
  on public.local_files (org_id, activity_folder);

create index if not exists idx_local_files_org_status
  on public.local_files (org_id, status);
