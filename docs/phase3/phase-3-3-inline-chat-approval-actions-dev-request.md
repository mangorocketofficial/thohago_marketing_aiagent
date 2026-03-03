# Phase 3-3 Development Plan
## Inline Approve / Revise / Reject Handling in Chat

---

## Goal

Make dashboard chat action-cards fully interactive so approval decisions are handled inline in chat, not only through separate dashboard queue controls.

This phase establishes:

- Chat-native inline actions for `approve`, `request revision`, and `reject`.
- Inline edited-body submission for `content_draft` approval.
- Revision loops that re-propose updated campaign/content cards in chat.
- Realtime card state sync driven by `workflow_items` and projected `chat_messages`.

---

## Why This Phase

Phase 3-2 introduced workflow-linked action-card projection rows in `chat_messages`.
However, desktop chat currently renders text only and users still rely on queue-style controls for approval actions.

Phase 3-3 closes the UX contract gap by turning projected cards into executable chat UI controls.

This enables:

- one primary decision surface (chat timeline)
- version-aware and idempotent inline actions
- direct path to Phase 3-4 queue simplification

---

## Design Principles

1. `workflow_items` remains the canonical state machine.
2. Chat cards are interaction/projection UI, not state owners.
3. All inline actions must carry idempotency and expected-version context.
4. Dashboard channel is interactive; non-interactive channels stay text fallback.
5. Backward compatibility remains mandatory for existing resume contracts.
6. Action errors must fail safely with clear stale-state recovery UX.
7. Chat timeline action rendering uses `chat_messages` (`message_type='action_card'`) as single source of truth.
8. Revision path must keep the same `workflow_item` and advance version; do not fork into a new workflow item.

---

## Scope

### In Scope

- Desktop chat rendering for `message_type='action_card'` messages.
- Inline action controls in chat:
  - `Approve`
  - `Request Revision`
  - `Reject`
- Inline content edit box for approve-with-edit (`edited_body`) on `content_draft` cards.
- Revision loop backend handling from chat actions:
  - workflow `request_revision` transition
  - assistant regeneration
  - workflow `resubmitted` transition
  - new proposed action-card projection emission (new version key)
- Realtime action-card state reflection (resolved/disabled states).
- Smoke validation for inline action idempotency and revision replay safety.

### Out of Scope

- Telegram inline card interactivity.
- Full removal of dashboard approval queue surfaces.
- Bulk approval UX redesign.
- Large visual redesign unrelated to action-card execution.

---

## Current Baseline (Post Phase 3-2)

- `chat_messages` now stores `message_type`, `metadata`, `workflow_item_id`, `projection_key`.
- Orchestrator emits action-card projections for campaign/content proposal points.
- Orchestrator updates card metadata status on approve/reject.
- Desktop chat currently does not render action-card metadata as interactive UI.
- Existing IPC/API flow supports:
  - `campaign_approved`
  - `content_approved` (+ optional `edited_body`)
  - `campaign_rejected`
  - `content_rejected`

Gap:

- `Request Revision` exists in card metadata but has no full inline revision execution loop in chat UX.

---

## Target Interaction Model

### 1) Campaign Card (`card_type='campaign_plan'`)

Inline card shows:

- title
- channels
- post count
- date range
- current workflow status badge

Inline actions:

- `Approve` -> `campaign_approved`
- `Request Revision` -> revision path (non-terminal)
- `Reject` -> terminal reject path

### 2) Content Card (`card_type='content_draft'`)

Inline card shows:

- title
- channel
- draft preview
- optional warning chips (forbidden/quality metadata)

Inline actions:

- `Approve` (optional edited body text area)
- `Request Revision`
- `Reject`

### 3) Pending / Resolved UX

- While action request is in-flight, card buttons are disabled and show pending indicator.
- On success, realtime payload updates card status/actions.
- On `version_conflict`, show stale warning and auto-refresh latest session/messages.

---

## Revision Handling Strategy

Use existing external event compatibility while enabling revision semantics.

### Action Payload Convention

For revision requests, client sends:

```json
{
  "event_type": "campaign_rejected",
  "payload": {
    "campaign_id": "<id>",
    "mode": "revision",
    "reason": "..."
  }
}
```

(Equivalent for `content_rejected` with `content_id`.)

### Backend Branching

When `event_type` is reject and `payload.mode == 'revision'`:

1. apply workflow action `request_revision`
2. regenerate proposal (campaign/content) using revision reason + existing context
3. apply workflow action `resubmitted`
4. emit new proposed action-card projection with incremented `expected_version`
5. keep session in same approval wait step (`await_campaign_approval` or `await_content_approval`)

When reject has no revision mode:

- preserve current terminal reject behavior

### Revision Regeneration Scope (Finalized)

- `campaign_plan`:
  - LLM re-generation using prior `plan` + `revision reason` + existing RAG context.
  - Update existing campaign row (`campaigns.plan`, `campaigns.channels`) instead of creating a new campaign.
- `content_draft`:
  - LLM re-generation using prior `draft body` + `revision reason` + existing RAG context.
  - Update existing content row (`contents.body`) and keep `pending_approval`.
- Workflow/version policy:
  - Same workflow item is reused (`workflow_item_id` unchanged).
  - Version advances via `request_revision -> resubmitted`; new projection card key uses the new version.

### Phase 3-3 Practical Boundary

- Revision implementation is "revision-aware generation" with minimal new branching:
  - `campaign_plan`: provide previous plan + reason in generation prompt.
  - `content_draft`: provide previous body + reason in generation prompt.
- Do not introduce a separate long-running revision pipeline in 3-3.
- Keep existing orchestrator control flow (paused approval loop) and contracts.

---

## Idempotency and Concurrency

### Client Action Idempotency Key

Inline action dispatch key format:

```txt
chat_action:${session_id}:${workflow_item_id}:${action_id}:v${expected_version}
```

Optional suffix (when needed): normalized hash of editable inputs (for edited body/reason).

### Server Enforcement

- Workflow transitions remain protected by workflow event idempotency keys.
- Projection emission remains deduped by deterministic `projection_key`.
- Version mismatch returns conflict and triggers stale-card UX recovery.

### Version Conflict Contract

- API returns `409` with `error='version_conflict'`.
- Error payload should include recoverable metadata for UX:
  - `workflow_item_id`
  - `current_version`
  - `expected_version` (if provided by client)
  - `workflow_status`
- Client behavior on conflict:
  - show stale-card notice
  - refetch latest active session + chat messages
  - keep UI recoverable without app reload

---

## Data / Contract Changes

### 1) Shared Types (`packages/types`)

- Add typed action-card metadata helpers for frontend rendering guards.
- Add card action request payload type for inline UI dispatch.
- Add explicit `mode='revision'` payload typing and `expected_version` typing.

### 2) Desktop Runtime IPC (`apps/desktop/electron/main.mjs`, `src/global.d.ts`)

- Add chat runtime handler for revision requests (or extend existing reject handler with explicit `mode`).
- Keep existing approve/reject handlers backward compatible.
- Standardize idempotency key canonicalization (normalize editable inputs before hashing).

### 3) API Orchestrator (`apps/api/src/orchestrator`)

- Extend reject path to support revision-mode branch.
- Add regeneration + resubmission helpers for campaign/content.
- Preserve existing terminal reject path and error contracts.
- Validate `event_type + payload.mode` compatibility at route/service boundary.

No mandatory DB schema migration is required for Phase 3-3.

---

## Delivery Plan

### 1) Orchestrator Revision Loop (Backend First)

- Implement `mode='revision'` branch for reject events.
- Apply workflow `request_revision -> resubmitted` transitions.
- Regenerate proposal payloads and emit new proposed cards.
- Keep step/state paused on approval step after revision resubmission.

### 2) IPC / Main Process

- Add/extend IPC methods for revision requests and structured action payload forwarding.
- Preserve existing telemetry events (`onActionResult`, `onActionError`).
- Return/propagate structured `version_conflict` information to renderer UX.

### 3) Desktop Chat Rendering + Action Dispatch

- Render `action_card` messages in `AgentChat` timeline.
- Introduce card components with status badges and action buttons.
- Add action dispatch abstraction in renderer (`approve`, `request_revision`, `reject`).
- Build deterministic idempotency keys from card metadata.
- Handle optimistic pending state and disable duplicate clicks.
- Add inline editor for content approval edits (`edited_body` as full-body textarea).

### 4) Validation

- Extend smoke test coverage with inline revision scenarios and replay checks.
- Validate no duplicate cards on action replay.
- Validate status reflection on old/new cards across revision cycle.
- Validate stale-card conflict handling with forced old `expected_version`.

---

## Target File Additions

- `docs/phase3/phase-3-3-inline-chat-approval-actions-dev-request.md`
- (implementation) `apps/desktop/src/components/chat-action-card/*` (or equivalent)

## Target File Updates

- `apps/desktop/src/pages/AgentChat.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/global.d.ts`
- `apps/desktop/electron/main.mjs`
- `apps/api/src/orchestrator/types.ts`
- `apps/api/src/orchestrator/service.ts`
- `packages/types/src/index.ts`
- `scripts/smoke-phase-1-5a.mjs` (or new phase-3-3 smoke script)

---

## Acceptance Criteria

1. `action_card` messages render as interactive cards in dashboard chat timeline.
2. Campaign card supports inline approve / request revision / reject actions.
3. Content card supports inline approve (with optional edited body) / request revision / reject actions.
4. Revision request generates a new proposed card with incremented workflow version.
5. Terminal actions update card metadata status and disable invalid actions.
6. Replay of same inline action idempotency key does not duplicate workflow events or cards.
7. Version conflict returns recoverable stale-card UX path with structured conflict metadata.
8. Existing non-inline approval paths remain backward compatible.
9. `pnpm --filter @repo/desktop type-check` passes.
10. `pnpm --filter @repo/api type-check` passes.
11. Updated smoke assertions pass for inline action scenarios.
12. Previous revision versions render collapsed by default; latest proposed card remains primary active card.

---

## Risks and Controls

| Risk | Impact | Control |
|---|---|---|
| Stale card action against old version | user confusion / 409 errors | use `expected_version` from metadata + stale-card refresh UX |
| Duplicate action submissions | duplicated transitions or noisy UX | deterministic action idempotency key + disabled pending buttons |
| Revision and reject semantic confusion | wrong terminal/non-terminal behavior | explicit `payload.mode='revision'` contract + route/service validation + API branch tests |
| UI/backend contract drift | broken inline action mapping | shared typed metadata/action payload contracts |
| Chat timeline clutter after many revisions | reduced readability | 3-3 MVP: older versions collapsed by default, latest proposed version expanded |
| Idempotency drift from input formatting | duplicate events for equivalent text | canonicalized editable input hashing in idempotency key builder |

---

## Definition of Done for Phase 3-3

- Users can complete approve/revise/reject decisions directly from chat action-cards.
- Revision loops are functional and emit new versioned proposed cards.
- Existing APIs and fallback text behavior remain compatible.
- System is ready for Phase 3-4 queue simplification and bulk action tuning.

---

*Document version: v1.0*  
*Phase: 3-3*  
*Title: Inline Approve / Revise / Reject Handling in Chat*  
*Created: 2026-03-03*
