# Phase 3-1 Development Plan
## Workflow Item State Machine (Source of Truth) Foundation

---

## Goal

Introduce a canonical approval workflow domain model so `chat` and `approval queue` become two views over the same data, not two separate systems.

This phase establishes:

- `workflow_items` as the source of truth for proposal/approval lifecycle.
- `workflow_events` as immutable audit history with idempotency.
- Compatibility adapters so current approve/reject flows and RAG feedback (Phase 2-5a) keep working.

---

## Why This Phase

Current behavior is split across:

- conversation in `chat_messages`
- actionable approval state in `contents.status = 'pending_approval'`

That split creates UX and system drift risk. Users experience one conversation, but backend logic is distributed across multiple models.

Phase 3-1 does not redesign UI yet. It creates the data/state foundation required for:

- Phase 3-2: orchestrator emits workflow + chat action-card projections
- Phase 3-3: inline approve/revise/reject in chat
- Phase 3-4: dashboard approval queue reduced to pending filter view (+ bulk actions retained)

---

## Design Principles

1. Chat is the primary interaction surface.
2. Workflow domain is the system of record.
3. Approval queue is a filtered projection (`pending`) over workflow state.
4. No dual write ownership: one canonical state machine, legacy tables receive mirrored state during transition.
5. All state changes must be auditable, idempotent, and concurrency-safe.

---

## Scope

### In Scope

- Add `workflow_items` table for lifecycle state.
- Add `workflow_events` table for append-only transition history.
- Introduce transition rules (`proposed -> approved | rejected | revision_requested`).
- Add optimistic concurrency (`version`) and action idempotency (`idempotency_key`).
- Define and implement legacy status mirroring strategy to `contents.status`.
- Keep existing orchestrator approve/reject API contracts as adapters to workflow actions.
- Add backend/domain tests for transition, idempotency, and version conflict.

### Out of Scope

- Rendering inline action cards in chat UI.
- Removing existing dashboard approval UI.
- Full orchestrator projection redesign (Phase 3-2).
- Decommissioning legacy `contents.status` reads/writes.

---

## Current Baseline (As-Is)

- `chat_messages` stores plain text messages only.
- `contents.status` drives pending approval list (`pending_approval`) in dashboard.
- Orchestrator `content_approved` currently updates content status and triggers:
  - content embedding (`onContentPublished`)
  - edit-pattern embedding (`onContentEdited`)
  - memory cache invalidation (`invalidateMemoryCache`)

Risk: introducing workflow without adapter compatibility can break Phase 2-5a feedback loop.

---

## Target Data Model (Phase 3-1)

### 1) `workflow_items` (canonical state)

```sql
create table if not exists public.workflow_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null check (type in (
    'campaign_plan',
    'content_draft',
    'content_generation_request',
    'generic_approval'
  )),
  status text not null check (status in (
    'proposed',
    'revision_requested',
    'approved',
    'rejected'
  )) default 'proposed',
  payload jsonb not null default '{}'::jsonb,
  origin_chat_message_id uuid references public.chat_messages(id) on delete set null,
  source_content_id uuid references public.contents(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Notes:

- `origin_chat_message_id` is intentionally not strict 1:1. A workflow item may produce multiple later chat messages.
- `source_content_id` supports clean transition with existing `contents` pipeline.
- `payload` holds draft body, channel, metadata, and revision context.

### 2) `workflow_events` (immutable history + idempotency)

```sql
create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow_item_id uuid not null references public.workflow_items(id) on delete cascade,
  action text not null check (action in (
    'proposed',
    'request_revision',
    'resubmitted',
    'approved',
    'rejected'
  )),
  actor_type text not null check (actor_type in ('user', 'assistant', 'system')),
  actor_user_id uuid references public.users(id),
  from_status text,
  to_status text not null,
  payload jsonb not null default '{}'::jsonb,
  expected_version bigint,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
```

### 3) Indexes and RLS

- Indexes:
  - `workflow_items(org_id, status, created_at desc)`
  - `workflow_items(org_id, type, status, created_at desc)`
  - `workflow_events(workflow_item_id, created_at asc)`
  - `workflow_events(org_id, created_at desc)`
- Enable/force RLS and apply org-member policy pattern consistent with existing tables.

---

## State Machine

### Statuses

- `proposed`: awaiting decision
- `revision_requested`: user requested changes, awaiting regenerated proposal
- `approved`: terminal success
- `rejected`: terminal close

### Allowed Transitions

| Action | From | To | Guard |
|---|---|---|---|
| `request_revision` | `proposed` | `revision_requested` | actor is org member |
| `resubmitted` | `revision_requested` | `proposed` | assistant/system provides revised payload |
| `approved` | `proposed` | `approved` | `expected_version` matches |
| `rejected` | `proposed`, `revision_requested` | `rejected` | actor is org member |

Hard rules:

- No transition from terminal states.
- Every mutation writes one `workflow_events` row.
- Every mutation requires an `idempotency_key`.
- Mutations that change state must enforce optimistic lock (`expected_version`).

---

## Transition Strategy for `contents.status` (No Dual Source of Truth)

During transition, `workflow_items.status` is canonical and `contents.status` is mirrored for compatibility.

Mirror mapping for `type = 'content_draft'`:

- `proposed` -> `pending_approval`
- `revision_requested` -> `pending_approval` (with revision marker in metadata)
- `approved` -> `published` (keeps current simulation behavior)
- `rejected` -> `rejected`

Rules:

- User action endpoints write workflow state first.
- Legacy `contents` update is executed by workflow adapter/service, not directly by UI handler logic.
- Any future read path should gradually shift from `contents.status` to workflow query.

---

## API and Service Contract (Phase 3-1)

### Internal Domain Service

Add workflow domain service (single mutation path):

- `createWorkflowItem(input)`
- `applyWorkflowAction({ itemId, action, actor, payload, expectedVersion, idempotencyKey })`
- `getPendingWorkflowItems(orgId, filters)`

### Adapter Policy (Backward Compatibility Required)

Keep existing external approval calls stable:

- Existing orchestrator resume events (`content_approved`, `content_rejected`, etc.) remain callable.
- Internally map them to `applyWorkflowAction(...)`.
- Keep existing side effects (RAG embedding/edit-pattern/memory invalidation) unchanged.

This prevents regression in Phase 2-5a while replacing internals.

---

## Delivery Plan

### 1) DB Migration

- Create `workflow_items`
- Create `workflow_events`
- Add indexes, `updated_at` trigger, RLS policies
- Optional backfill for currently pending content drafts into `workflow_items` (guarded and idempotent)

### 2) Type Contracts

- Add `WorkflowItem`, `WorkflowEvent`, `WorkflowStatus`, `WorkflowAction` to `packages/types`

### 3) API/Domain Layer

- Add workflow service module in API
- Add repository queries for create/mutate/list
- Add adapter bridge from existing approval paths to workflow actions
- Add structured error codes:
  - `version_conflict`
  - `invalid_transition`
  - `idempotent_replay`

### 4) Legacy Compatibility Hooks

- Centralize `contents.status` mirror update in workflow adapter
- Keep current RAG side effects invocation points intact

### 5) Tests

- Transition matrix tests
- Idempotency replay tests
- Optimistic lock conflict tests
- Regression test: `content_approved` still updates publish path and triggers RAG callbacks

---

## Target File Additions

- `supabase/migrations/<timestamp>_phase_3_1_workflow_items.sql`
- `apps/api/src/workflow/service.ts`
- `apps/api/src/workflow/repository.ts`
- `apps/api/src/workflow/types.ts`
- `apps/api/src/workflow/errors.ts`

## Target File Updates

- `apps/api/src/orchestrator/service.ts` (adapter bridge only, no UX redesign)
- `packages/types/src/index.ts` (workflow type contracts)

---

## Acceptance Criteria

1. `workflow_items` and `workflow_events` exist with RLS and required indexes.
2. All workflow mutations are recorded in `workflow_events`.
3. Action idempotency works (`org_id + idempotency_key` unique replay-safe).
4. Version conflicts return deterministic error (`409 version_conflict` equivalent).
5. Invalid transitions are blocked (`invalid_transition`).
6. Existing approval entry points still function without frontend changes.
7. `content_approved` path still triggers:
   - publish status update (via workflow mirror)
   - content embedding callback
   - edit-pattern callback (when edited)
   - memory cache invalidation
8. Dashboard pending list remains behavior-compatible during transition.
9. `pnpm --filter @repo/api type-check` passes.
10. Existing smoke tests for Phase 2-5a approval loop remain passing.

---

## Risks and Controls

| Risk | Impact | Control |
|---|---|---|
| Dual-state drift between workflow and contents | inconsistent UI/action behavior | Make workflow canonical, mirror `contents` only in one adapter path |
| Lost updates from concurrent approvals | wrong final state | `expected_version` optimistic lock + 409 conflict |
| Duplicate clicks/retries creating duplicate transitions | duplicate side effects | unique idempotency key in `workflow_events` |
| Breaking existing RAG feedback loop | regression in memory quality pipeline | keep existing approve/reject API contract and adapt internally |
| Query regression for dashboard pending list | UX instability | preserve legacy pending behavior until Phase 3-4 projection switch |

---

## Definition of Done for Phase 3-1

- Workflow state machine foundation is live and tested.
- Existing approval workflow remains operational through adapter path.
- No UI redesign required for this phase.
- Repository is ready for Phase 3-2 projection work.

---

*Document version: v1.0*  
*Phase: 3-1*  
*Title: Workflow Item State Machine (Source of Truth) Foundation*  
*Created: 2026-03-03*
