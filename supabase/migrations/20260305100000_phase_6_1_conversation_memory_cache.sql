-- Phase 6-1: conversation memory + preference memory + LLM response cache
-- Safe rollout:
-- 1) Additive schema only
-- 2) RLS policies aligned with existing org membership model

-- =====================
-- session_memory (episodic memory)
-- =====================
create table if not exists public.session_memory (
  session_id uuid primary key references public.orchestrator_sessions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  rolling_summary_json jsonb not null default '{}'::jsonb,
  rolling_summary_text text not null default '',
  source_message_count integer not null default 0 check (source_message_count >= 0),
  last_compacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_session_memory_org_updated
  on public.session_memory (org_id, updated_at desc);

drop trigger if exists session_memory_updated_at on public.session_memory;
create trigger session_memory_updated_at
before update on public.session_memory
for each row
execute function public.update_updated_at();

-- =====================
-- conversation_preferences (long-term memory)
-- =====================
create table if not exists public.conversation_preferences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  preference_key text not null,
  preference_value text not null,
  confidence numeric(4,3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  evidence_count integer not null default 1 check (evidence_count >= 1),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_conversation_preferences_scope_key_value
  on public.conversation_preferences (
    org_id,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    preference_key,
    preference_value
  );

create index if not exists idx_conversation_preferences_org_user_seen
  on public.conversation_preferences (org_id, user_id, last_seen_at desc);

drop trigger if exists conversation_preferences_updated_at on public.conversation_preferences;
create trigger conversation_preferences_updated_at
before update on public.conversation_preferences
for each row
execute function public.update_updated_at();

-- =====================
-- llm_response_cache (application-level cache)
-- =====================
create table if not exists public.llm_response_cache (
  cache_key text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  model text not null,
  request_hash text not null,
  response_text text not null,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_llm_response_cache_org_expires
  on public.llm_response_cache (org_id, expires_at);

create index if not exists idx_llm_response_cache_expires
  on public.llm_response_cache (expires_at);

-- =====================
-- RLS
-- =====================
alter table public.session_memory enable row level security;
alter table public.session_memory force row level security;

alter table public.conversation_preferences enable row level security;
alter table public.conversation_preferences force row level security;

alter table public.llm_response_cache enable row level security;
alter table public.llm_response_cache force row level security;

drop policy if exists "org members can manage session memory" on public.session_memory;
create policy "org members can manage session memory"
  on public.session_memory
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

drop policy if exists "org members can manage conversation preferences" on public.conversation_preferences;
create policy "org members can manage conversation preferences"
  on public.conversation_preferences
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

drop policy if exists "org members can manage llm response cache" on public.llm_response_cache;
create policy "org members can manage llm response cache"
  on public.llm_response_cache
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

