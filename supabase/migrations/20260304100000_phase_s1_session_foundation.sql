-- Phase S1: session foundation for multi-session support
-- Safe rollout:
-- 1) Additive schema first
-- 2) Constraint/index transition with replacement safety
-- 3) Deterministic backfill only (action-card metadata.session_id)

-- =====================
-- orchestrator_sessions: workspace foundation
-- =====================
alter table public.orchestrator_sessions
  add column if not exists workspace_type text,
  add column if not exists scope_id text,
  add column if not exists workspace_key text,
  add column if not exists title text,
  add column if not exists created_by_user_id uuid,
  add column if not exists archived_at timestamptz;

update public.orchestrator_sessions
set workspace_type = 'general'
where workspace_type is null
   or btrim(workspace_type) = '';

update public.orchestrator_sessions
set scope_id = 'default'
where scope_id is null
   or btrim(scope_id) = '';

update public.orchestrator_sessions
set workspace_key = lower(btrim(workspace_type)) || ':' || coalesce(nullif(btrim(scope_id), ''), 'default')
where workspace_key is null
   or btrim(workspace_key) = '';

alter table public.orchestrator_sessions
  alter column workspace_type set default 'general',
  alter column workspace_type set not null,
  alter column workspace_key set default 'general:default',
  alter column workspace_key set not null;

drop index if exists public.uq_orchestrator_sessions_org_active;

create unique index if not exists uq_orchestrator_sessions_org_workspace_active
  on public.orchestrator_sessions (org_id, workspace_key)
  where status in ('running', 'paused');

create index if not exists idx_orchestrator_sessions_org_workspace_scope_updated
  on public.orchestrator_sessions (org_id, workspace_type, scope_id, updated_at desc);

create index if not exists idx_orchestrator_sessions_org_status_updated
  on public.orchestrator_sessions (org_id, status, updated_at desc);

-- =====================
-- chat_messages: session-scoped timeline foundation
-- =====================
alter table public.chat_messages
  add column if not exists session_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_session_id_fkey'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_session_id_fkey
      foreign key (session_id)
      references public.orchestrator_sessions(id)
      on delete set null;
  end if;
end
$$;

create index if not exists idx_chat_messages_org_session_created_at
  on public.chat_messages (org_id, session_id, created_at desc);

-- Deterministic backfill only:
-- action_card rows that already carry metadata.session_id and point to an existing session.
with mapped as (
  select
    m.id,
    (m.metadata ->> 'session_id')::uuid as mapped_session_id
  from public.chat_messages m
  where m.session_id is null
    and m.message_type = 'action_card'
    and jsonb_typeof(m.metadata) = 'object'
    and m.metadata ? 'session_id'
    and (m.metadata ->> 'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.chat_messages m
set session_id = mapped.mapped_session_id
from mapped
where m.id = mapped.id
  and exists (
    select 1
    from public.orchestrator_sessions s
    where s.id = mapped.mapped_session_id
  );

