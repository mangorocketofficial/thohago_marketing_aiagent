-- Phase 2-5a: Content feedback loop foundation

-- Track whether published/historical content has been embedded to RAG.
alter table public.contents
  add column if not exists embedded_at timestamptz;

-- Pending content scan index for backfill endpoint.
create index if not exists idx_contents_org_pending_embed
  on public.contents (org_id, status)
  where status in ('published', 'historical')
  and embedded_at is null;

-- Recent publish scan index for lightweight insights aggregation.
create index if not exists idx_contents_org_published_at
  on public.contents (org_id, published_at desc)
  where status in ('published', 'historical');

-- Reset embedded_at whenever content payload materially changes.
create or replace function public.reset_content_embedded_at_on_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if (
    (
      old.status is distinct from new.status
      and new.status in ('published', 'historical')
    )
    or old.body is distinct from new.body
    or old.channel is distinct from new.channel
    or old.content_type is distinct from new.content_type
    or old.metadata is distinct from new.metadata
    or old.published_at is distinct from new.published_at
  ) then
    new.embedded_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists contents_reset_embedded_at on public.contents;
create trigger contents_reset_embedded_at
before update on public.contents
for each row
execute function public.reset_content_embedded_at_on_change();
