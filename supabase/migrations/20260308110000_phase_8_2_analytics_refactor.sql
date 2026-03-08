-- Phase 8-2: Analytics read-model and metrics schema cleanup

alter table public.content_metrics
  add column if not exists views integer check (views is null or views >= 0);

update public.content_metrics
set
  views = coalesce(views, likes),
  likes = null
where channel in ('naver_blog', 'youtube');
