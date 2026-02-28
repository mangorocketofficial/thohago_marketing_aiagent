# Phase 1-5a Development Request
## Marketing AI Agent Platform - Backend Flow Skeleton (v1.1)

---

## Overview

This document defines Phase **1-5a**: backend-first delivery of the full flow skeleton.

Goal: make the trigger-to-session-to-publish pipeline runnable without frontend dependency.

**Depends on:** Phase 1-4 (`pipeline_triggers` relay payload from Electron watcher).

---

## Why 1-5a Exists

Phase 1-5 was split to reduce scope risk.

- 1-5a focuses on API, DB, orchestration, resume logic, and backend acceptance tests.
- 1-5b will consume these contracts from Electron renderer UI.

---

## Core Decisions

1. **No LangGraph in 1-5a.**
Use a TypeScript manual state machine in `apps/api`.
2. **Single model vendor in 1-5a.**
Use Anthropic Claude for detect/campaign/content stub generation.
3. **One active session per org.**
New triggers while active session exists are queued.
4. **Schema field alignment is strict.**
`pipeline_triggers` uses `relative_path`.
5. **Server-side privileged writes only.**
`SUPABASE_SERVICE_ROLE_KEY` is used only in `apps/api`.

---

## Objectives

- [ ] Scaffold `apps/api` (TypeScript + Express/Fastify, minimal dependencies)
- [ ] Implement authenticated `POST /trigger` relay endpoint
- [ ] Add DB migration for `campaigns`, `orchestrator_sessions`, and table updates
- [ ] Implement manual orchestrator state machine with pause/resume persistence
- [ ] Implement campaign and content stub generation using Claude
- [ ] Implement simulated publish (`contents.status = 'published'`)
- [ ] Implement queue policy for concurrent triggers in same org
- [ ] Update root dev workflow to run `@repo/api` with desktop

---

## 1. API App Scope (`apps/api`)

### Required routes

- `GET /health`
- `POST /trigger`
  - Source: Electron `pipeline-trigger-relay.mjs`
  - Auth: `x-trigger-token` matches `API_SECRET`
  - Action: insert trigger row, enqueue/start orchestrator
- `POST /sessions/:sessionId/resume`
  - Source: future UI actions (via Electron main)
  - Body: `{ event_type, payload, idempotency_key }`
  - Action: lock session, apply event, execute next state transition

### Optional helper routes (recommended for 1-5a testing)

- `GET /sessions/:sessionId`
- `GET /orgs/:orgId/sessions/active`

---

## 2. Database Changes

**Migration file:**
`supabase/migrations/20260228110000_phase_1_5a_orchestration.sql`

### 2.1 Create `campaigns`

```sql
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  activity_folder text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'active', 'completed', 'cancelled')),
  channels jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger campaigns_updated_at
before update on public.campaigns
for each row execute function public.update_updated_at();

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;

create policy "org members can manage campaigns"
on public.campaigns
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

create index if not exists idx_campaigns_org_status
  on public.campaigns (org_id, status);
```

Note: `public.update_updated_at()` already exists from Phase 1-1.

### 2.2 Update `contents`

```sql
alter table public.contents
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create index if not exists idx_contents_org_campaign
  on public.contents (org_id, campaign_id);
```

### 2.3 Update `pipeline_triggers`

```sql
alter table public.pipeline_triggers
  add column if not exists processed_at timestamptz;
```

### 2.4 Create `orchestrator_sessions`

```sql
create table if not exists public.orchestrator_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_id uuid references public.pipeline_triggers(id) on delete set null,
  state jsonb not null default '{}'::jsonb,
  current_step text not null default 'detect'
    check (current_step in (
      'detect',
      'await_user_input',
      'await_campaign_approval',
      'generate_content',
      'await_content_approval',
      'publish',
      'done'
    )),
  status text not null default 'running'
    check (status in ('running', 'paused', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger orchestrator_sessions_updated_at
before update on public.orchestrator_sessions
for each row execute function public.update_updated_at();

alter table public.orchestrator_sessions enable row level security;
alter table public.orchestrator_sessions force row level security;

create policy "org members can manage sessions"
on public.orchestrator_sessions
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

create unique index if not exists uq_running_session_per_org
  on public.orchestrator_sessions (org_id)
  where status in ('running', 'paused');
```

---

## 3. Orchestrator State Machine (Manual)

### State

```ts
export type OrchestratorStep =
  | 'detect'
  | 'await_user_input'
  | 'await_campaign_approval'
  | 'generate_content'
  | 'await_content_approval'
  | 'publish'
  | 'done';
```

### Transition summary

- `detect` -> write assistant chat message -> `await_user_input`
- `await_user_input` + `user_message` -> generate campaign plan -> write campaign draft -> `await_campaign_approval`
- `await_campaign_approval` + `campaign_approved` -> update campaign approved -> `generate_content`
- `generate_content` -> write one text draft -> `await_content_approval`
- `await_content_approval` + `content_approved` -> simulated publish -> `done`

### Rejection behavior (minimum)

- campaign/content reject -> write chat feedback + mark session `failed`.

---

## 4. Resume Pattern (Concrete)

### Who triggers resume

- User action in client sends API call to `POST /sessions/:sessionId/resume`.

### How API resumes safely

1. Validate token and payload.
2. Load session row with lock (`select ... for update`).
3. Check `idempotency_key` was not processed.
4. Apply event to session state.
5. Run one or more deterministic transitions.
6. Persist state + `current_step` + `status`.
7. Insert resulting `chat_messages`/`campaigns`/`contents` updates.

### Concurrent trigger policy

- If org already has running/paused session:
  - insert new `pipeline_triggers` row as `pending`
  - do not start second session
  - log queue action

---

## 5. Trigger Relay Contract

`POST /trigger` body from desktop:

```json
{
  "org_id": "uuid",
  "relative_path": "activity/photo01.jpg",
  "file_name": "photo01.jpg",
  "activity_folder": "activity",
  "file_type": "image",
  "source_event_id": "dedupe-key"
}
```

Server insertion must use `relative_path` column.

---

## 6. AI Usage for 1-5a

- Provider: Anthropic only
- Model: configurable via env (default `claude-opus-4-5`)
- Scope:
  - detect message generation
  - campaign plan JSON stub
  - single content draft text stub

No OpenAI dependency in 1-5a.

---

## 7. Environment Variables

Add to `.env.example`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# API
API_PORT=3001
API_SECRET=

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-4-5
```

---

## 8. Monorepo / Dev Workflow Updates

- Add `apps/api` workspace package.
- Ensure root dev runs both desktop and api.

Recommended root script:

```json
{
  "scripts": {
    "dev": "turbo run dev --filter=@repo/desktop --filter=@repo/api"
  }
}
```

---

## 9. Acceptance Criteria (1-5a)

- [ ] `apps/api` starts and `GET /health` returns OK.
- [ ] Desktop relay can call `POST /trigger` with token auth.
- [ ] Trigger row is inserted in `pipeline_triggers` with `relative_path`.
- [ ] `processed_at` is set when orchestrator consumes trigger.
- [ ] Orchestrator creates `orchestrator_sessions` row and assistant chat message.
- [ ] Resume with `user_message` event creates `campaigns` draft row.
- [ ] Resume with `campaign_approved` event creates one `contents` draft row.
- [ ] Resume with `content_approved` event sets `contents.status = 'published'`.
- [ ] If second trigger arrives for same org during active session, it is queued (no second active session).
- [ ] `pnpm supabase:db:reset` applies all migrations cleanly.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.

---

## 10. Out of Scope (1-5a)

- Renderer chat UI and approval queue UI
- Realtime-driven desktop rendering
- Telegram integration
- Real publish APIs

---

*Document version: v1.1*
*Phase: 1-5a Backend Flow Skeleton*
*Depends on: Phase 1-4 (Electron Watcher & Onboarding)*
*Updated: 2026-02-28*
