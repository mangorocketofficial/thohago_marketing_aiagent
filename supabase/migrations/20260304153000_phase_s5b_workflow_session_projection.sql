-- Phase S5b: workflow-item session linkage + system notification projection foundation
-- Safe rollout:
-- 1) Additive schema changes only
-- 2) Deterministic/idempotent backfill for workflow_items.session_id
-- 3) Best-effort context_label backfill for session rail labeling

-- =====================
-- workflow_items extension
-- =====================
alter table public.workflow_items
  add column if not exists session_id uuid references public.orchestrator_sessions(id) on delete restrict,
  add column if not exists display_title text;

create index if not exists idx_workflow_items_session
  on public.workflow_items (session_id, created_at desc)
  where session_id is not null;

-- =====================
-- orchestrator_sessions extension
-- =====================
alter table public.orchestrator_sessions
  add column if not exists context_label text;

-- =====================
-- workflow_items.session_id deterministic backfill
-- Priority:
-- 1) origin_chat_message_id -> chat_messages.session_id
-- 2) nearest prior chat message in same org with non-null session_id
-- =====================
with origin_mapped as (
  select
    wi.id as workflow_item_id,
    cm.session_id as mapped_session_id
  from public.workflow_items wi
  join public.chat_messages cm
    on cm.id = wi.origin_chat_message_id
  where wi.session_id is null
    and cm.session_id is not null
)
update public.workflow_items wi
set session_id = mapped.mapped_session_id
from origin_mapped mapped
where wi.id = mapped.workflow_item_id
  and wi.session_id is null
  and exists (
    select 1
    from public.orchestrator_sessions s
    where s.id = mapped.mapped_session_id
  );

with fallback_mapped as (
  select
    wi.id as workflow_item_id,
    nearest.session_id as mapped_session_id
  from public.workflow_items wi
  join lateral (
    select cm.session_id
    from public.chat_messages cm
    where cm.org_id = wi.org_id
      and cm.session_id is not null
      and cm.created_at <= wi.created_at
    order by cm.created_at desc, cm.id desc
    limit 1
  ) nearest on true
  where wi.session_id is null
)
update public.workflow_items wi
set session_id = mapped.mapped_session_id
from fallback_mapped mapped
where wi.id = mapped.workflow_item_id
  and wi.session_id is null
  and exists (
    select 1
    from public.orchestrator_sessions s
    where s.id = mapped.mapped_session_id
  );

-- =====================
-- orchestrator_sessions.context_label best-effort backfill
-- Source:
-- first workflow item per session (created_at asc), then derive activity_folder
-- from linked campaign directly, or via source_content -> contents.campaign_id.
-- =====================
with first_workflow as (
  select distinct on (wi.session_id)
    wi.session_id,
    wi.source_campaign_id,
    wi.source_content_id
  from public.workflow_items wi
  where wi.session_id is not null
  order by wi.session_id, wi.created_at asc, wi.id asc
),
derived_label as (
  select
    fw.session_id,
    coalesce(
      nullif(btrim(c_direct.activity_folder), ''),
      nullif(btrim(c_from_content.activity_folder), '')
    ) as context_label
  from first_workflow fw
  left join public.campaigns c_direct
    on c_direct.id = fw.source_campaign_id
  left join public.contents ct
    on ct.id = fw.source_content_id
  left join public.campaigns c_from_content
    on c_from_content.id = ct.campaign_id
)
update public.orchestrator_sessions s
set context_label = dl.context_label
from derived_label dl
where s.id = dl.session_id
  and dl.context_label is not null
  and (
    s.context_label is null
    or btrim(s.context_label) = ''
  );
