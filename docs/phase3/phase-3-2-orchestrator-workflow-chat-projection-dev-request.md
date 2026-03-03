# Phase 3-2 Development Plan
## Orchestrator Workflow Creation + Chat Action-Card Projection

---

## Goal

Make orchestrator emit approval proposals as chat-native action-card projections while keeping `workflow_items` as the source of truth.

This phase establishes:

- Orchestrator creates/updates workflow state first.
- Orchestrator publishes chat projection messages linked to workflow items.
- Chat becomes the primary interaction surface contract at the data level (UI rendering comes in Phase 3-3).

---

## Why This Phase

Phase 3-1 introduced canonical workflow state and adapter-based compatibility.  
However, the assistant still emits text-only chat while approval semantics are not projected as structured chat messages.

Phase 3-2 closes that gap by emitting workflow-aware chat messages with action-card payloads, so the same domain event is consumable by:

- Chat timeline (primary UX surface)
- Approval queue read models (secondary filtered view)

---

## Design Principles

1. `workflow_items` remains canonical state.
2. Chat messages are projections, not state owners.
3. Projections must be idempotent and retry-safe.
4. Backward compatibility is mandatory (existing clients still read text content).
5. Existing approve/reject API contracts remain valid during transition.
6. Action-card records must be structurally valid at DB level (constraint-driven safety).
7. Workflow transition success comes first; projection write/update is strictly secondary.

---

## Scope

### In Scope

- Add structured projection fields to `chat_messages` for action cards.
- Emit action-card chat messages from orchestrator at proposal points.
- Attach workflow references (`workflow_item_id`, expected version) in projection payload.
- Preserve plain-text summary in `content` for legacy clients.
- Add projection idempotency key strategy to prevent duplicate action cards.

### Out of Scope

- Frontend inline action-card rendering and click handling UX (Phase 3-3).
- Full dashboard queue replacement (Phase 3-4).
- Removal of legacy `contents.status` mirroring.

---

## Current Baseline (Post Phase 3-1)

- Workflow domain exists (`workflow_items`, `workflow_events`) and is active.
- Orchestrator approve/reject paths are wired through workflow actions.
- `chat_messages` currently stores text-only messages (`role`, `content`, `channel`, `created_at`).
- Session resume API still uses existing event contracts (`campaign_approved`, `content_approved`, etc.).

---

## Target Data Model Changes (Phase 3-2)

### 1) Extend `chat_messages` for projections

```sql
alter table public.chat_messages
  add column if not exists message_type text not null default 'text'
    check (message_type in ('text', 'action_card', 'system')),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists workflow_item_id uuid
    references public.workflow_items(id) on delete set null,
  add column if not exists projection_key text;

create unique index if not exists idx_chat_messages_org_projection_key
  on public.chat_messages (org_id, projection_key);

create index if not exists idx_chat_messages_org_workflow_created
  on public.chat_messages (org_id, workflow_item_id, created_at desc)
  where workflow_item_id is not null;

alter table public.chat_messages
  drop constraint if exists chk_chat_messages_action_card_fields;

alter table public.chat_messages
  add constraint chk_chat_messages_action_card_fields
  check (
    message_type <> 'action_card'
    or (
      workflow_item_id is not null
      and projection_key is not null
      and jsonb_typeof(metadata) = 'object'
      and metadata ->> 'projection_type' = 'workflow_action_card'
      and metadata ? 'workflow_item_id'
      and metadata ? 'expected_version'
      and metadata ? 'workflow_status'
    )
  );

alter table public.chat_messages
  drop constraint if exists chk_chat_messages_system_role;

alter table public.chat_messages
  add constraint chk_chat_messages_system_role
  check (
    message_type <> 'system'
    or role = 'assistant'
  );
```

Notes:

- `content` stays required for backward-compatible fallback summary.
- `metadata` contains action-card JSON payload for structured rendering.
- `projection_key` guarantees idempotent projection emission.
- `message_type='action_card'` rows must include workflow reference fields by DB constraint.
- `message_type='system'` stays compatible with existing `role in ('user','assistant')` by enforcing `role='assistant'`.

### 2) Projection Payload Shape (`metadata`)

```json
{
  "projection_type": "workflow_action_card",
  "card_type": "campaign_plan",
  "workflow_item_id": "<uuid>",
  "workflow_status": "proposed",
  "expected_version": 1,
  "session_id": "<orchestrator_session_id>",
  "actions": [
    { "id": "approve", "label": "Approve", "event_type": "campaign_approved" },
    { "id": "request_revision", "label": "Request Revision", "event_type": "campaign_rejected", "mode": "revision" },
    { "id": "reject", "label": "Reject", "event_type": "campaign_rejected" }
  ],
  "card_data": {
    "title": "string",
    "channels": ["instagram", "threads"],
    "post_count": 3,
    "date_range": { "start": "2026-03-03", "end": "2026-03-09" }
  }
}
```

Card variants for this phase:

- `campaign_plan`
- `content_draft`
- optional `content_generation_request` (if emitted in detect/on-demand paths)

Card data minimum schema:

- `campaign_plan`:
  - `title: string`
  - `channels: string[]`
  - `post_count: number`
  - `date_range: { start: string; end: string }`
- `content_draft`:
  - `title: string`
  - `channel: string`
  - `body_preview: string`
  - `media_urls: string[]`

### 3) Deterministic `projection_key` Strategy

Projection key must be deterministic and version-aware:

```txt
projection_key = `wf_card:${channel}:${workflow_item_id}:${event_type}:v${expected_version}`
```

Examples:

- campaign proposal card: `wf_card:dashboard:<workflow_item_id>:campaign_proposed:v1`
- content draft proposal card: `wf_card:dashboard:<workflow_item_id>:content_proposed:v1`
- resubmitted proposal card after revision: `wf_card:dashboard:<workflow_item_id>:campaign_proposed:v3`

Rationale:

- same logical replay -> same key -> dedupe
- new workflow version after resubmission -> new key -> new card emission allowed
- channel included to prevent cross-channel key collision

---

## Orchestrator Projection Rules

### Rule A: Campaign proposal projection

When user message produces campaign draft:

1. ensure/create `workflow_item(type='campaign_plan', status='proposed')`
2. emit chat action-card projection linked to workflow item
3. keep plain summary text in `content`
4. patch `workflow_items.origin_chat_message_id` with emitted projection message id (projection is write-after-workflow)

### Rule B: Content draft proposal projection

When campaign approval produces first content draft:

1. ensure/create `workflow_item(type='content_draft', status='proposed')`
2. emit chat action-card projection linked to workflow item
3. include draft body preview metadata in card payload
4. patch `workflow_items.origin_chat_message_id` with emitted projection message id

### Rule C: Idempotent replay behavior

If same resume event is retried:

- do not duplicate projection message
- return existing session progression result
- projection dedupe uses deterministic `projection_key`
- insert uses `on conflict (org_id, projection_key) do nothing` (or equivalent safe upsert path)

### Rule D: Action card status reflection (message update policy)

Chosen strategy: `A) metadata update`

- On `approved` / `rejected` / `request_revision` / `resubmitted`, update the existing latest action-card message for that workflow item.
- Update `metadata.workflow_status`, `metadata.expected_version`, and `metadata.actions` (disable or remove invalid actions for terminal state).
- Keep row identity/history (`id`, `created_at`, `projection_key`) stable so users can see "this card was resolved".
- New card rows are emitted only when workflow returns to `proposed` with a new version.

---

## API and Contract Strategy

### Keep existing resume contract stable

- Continue supporting:
  - `campaign_approved`
  - `campaign_rejected`
  - `content_approved`
  - `content_rejected`
- Action-card payload uses these existing event types for now.
- Dashboard uses action-card projection; telegram uses text-only fallback (no interactive action-card projection row).

### New shared type contract additions

- Extend `ChatMessage` with:
  - `message_type`
  - `metadata`
  - `workflow_item_id`
  - `projection_key`

No breaking change:

- Existing clients can ignore new fields and still render `content`.

---

## Delivery Plan

### 1) DB Migration

- Add chat projection columns/indexes to `chat_messages`.

### 2) API Workflow Projection Module

- Add projection builder helper (e.g., `apps/api/src/workflow/projection.ts`):
  - payload schema builders by card type
  - deterministic projection key generator
  - metadata status patch helper for approval/rejection/revision transitions

### 3) Orchestrator Integration

- Replace plain proposal message insertion with:
  - text fallback + structured action-card metadata
  - workflow linkage (`workflow_item_id`)
- For dashboard channel:
  - write action-card via deterministic `projection_key`
  - patch workflow `origin_chat_message_id` after successful projection write
- For telegram channel:
  - keep text fallback only
- On workflow transition completion:
  - update linked card metadata status (`workflow_status`, `expected_version`, actions availability)

### 4) Type Updates

- Update `packages/types` and API-local chat types for projection fields.

### 5) Validation

- Extend smoke coverage to assert:
  - action-card message rows exist
  - `workflow_item_id` populated
  - projection idempotency (no duplicate message rows on event replay)

---

## Target File Additions

- `supabase/migrations/<timestamp>_phase_3_2_chat_action_card_projection.sql`
- `apps/api/src/workflow/projection.ts`

## Target File Updates

- `apps/api/src/orchestrator/service.ts`
- `packages/types/src/index.ts`
- `packages/db/src/queries/chat-messages.ts` (if projection fields are selected/mapped there)
- `apps/desktop/src/...` (type-only or non-breaking fetch mapping updates, no UX redesign)

---

## Acceptance Criteria

1. `chat_messages` supports structured action-card projections (`message_type`, `metadata`, `workflow_item_id`, `projection_key`).
2. Campaign proposal creates one workflow-linked action-card message.
3. Content draft proposal creates one workflow-linked action-card message.
4. Projection rows remain replay-safe (no duplicates for same logical event).
5. Existing resume APIs continue to work without contract break.
6. Legacy text chat rendering still works from `content`.
7. `pnpm --filter @repo/api type-check` passes.
8. Approval smoke flow passes with projection assertions.
9. Action-card rows for resolved items show updated `metadata.workflow_status`.
10. New proposed version after revision emits a new card (`projection_key` includes version).
11. DB constraints block malformed action-card rows.

---

## Risks and Controls

| Risk | Impact | Control |
|---|---|---|
| Workflow/projection drift | chat card references stale state | always create/read workflow first, project second with workflow version in payload |
| Duplicate action cards on retries | noisy UX + user confusion | `projection_key` unique index and deterministic key generation |
| Breaking old chat clients | regression in current UI | keep `content` fallback and default `message_type='text'` |
| Over-coupling card schema to UI | frequent backend churn | define minimal stable projection schema (`card_type`, `actions`, `card_data`) |
| Channel mismatch (dashboard vs telegram) | unsupported actions in non-interactive channels | emit action-card projection only for dashboard channel; telegram gets text fallback |
| Malformed action-card writes | runtime render errors / broken UI contracts | DB check constraints for action-card required fields |
| Write failure between workflow and projection | workflow created but no linked chat card | explicit workflow-first then projection write, plus `origin_chat_message_id` patch + retry-safe upsert |

---

## Definition of Done for Phase 3-2

- Orchestrator emits workflow-linked action-card projections in chat at proposal points.
- Projection data is idempotent, version-aware, and backward-compatible.
- Resolved actions are reflected on existing cards via metadata updates.
- Repository is ready for Phase 3-3 inline action handling in chat UI.

---

*Document version: v1.1*  
*Phase: 3-2*  
*Title: Orchestrator Workflow Creation + Chat Action-Card Projection*  
*Created: 2026-03-03*
