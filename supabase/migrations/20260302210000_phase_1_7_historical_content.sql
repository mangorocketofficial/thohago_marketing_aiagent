-- Phase 1-7 Patch: Allow historical crawled content in contents table

-- Extend status to include 'historical' for pre-platform content
alter table public.contents
  drop constraint if exists contents_status_check;

alter table public.contents
  add constraint contents_status_check
  check (status in (
    'draft', 'pending_approval', 'approved', 'published', 'rejected',
    'historical'   -- crawled from existing channels during onboarding
  ));

-- Extend created_by to include 'onboarding_crawl'
alter table public.contents
  drop constraint if exists contents_created_by_check;

alter table public.contents
  add constraint contents_created_by_check
  check (created_by in (
    'ai', 'user',
    'onboarding_crawl'   -- bulk-imported from crawler output
  ));

-- Index for efficient historical content queries
-- Phase 2-5a will query: org_id + status IN ('published', 'historical') + embedded_at IS NULL
create index if not exists idx_contents_org_status_historical
  on public.contents (org_id, status)
  where status in ('published', 'historical');
