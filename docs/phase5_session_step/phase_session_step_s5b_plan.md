# Step S5b Development Plan (Work Item Session Linking + Backend Projection Migration)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S5b
- Status: Approved for implementation
- Depends on: S5a completion

## 1) Context

S5a delivers the Workspace shell with Inbox/Chat/Session Rail and removes action cards from the chat timeline via client-side filtering. However, two foundational gaps remain:

1. **Missing session provenance**: `workflow_items` records have no `session_id`, making it impossible to trace which session produced which work item or to link Inbox items back to their originating chat context.
2. **Backend still emits action cards**: `chat-projection.ts` continues inserting `message_type = "action_card"` rows into `chat_messages`. S5a hides them client-side, but this creates unnecessary data and keeps a deprecated pattern alive.

**Design Decision**: `session_id` is added only to `workflow_items`, NOT to `campaigns` or `contents`. Campaigns and contents are long-lived entities that span multiple sessions (e.g., a campaign created in session A may receive additional content in sessions B and C). Forcing a single `session_id` on these entities would be semantically incorrect. Session provenance for campaigns/contents is traceable indirectly via `workflow_items.source_campaign_id` / `workflow_items.source_content_id` joins.

**Objective**: Extend `workflow_items` with `session_id` linkage, add `context_label` to sessions for auto-tagging, and migrate backend projection from action cards to lightweight system notifications. No new tables — only column additions and projection behavior changes.

## 2) Scope

In scope:

1. Add `session_id` column to `workflow_items` table only.
2. Add `display_title` column to `workflow_items` for Inbox rendering.
3. Add `context_label` column to `orchestrator_sessions` for session auto-tagging.
4. Backfill existing `workflow_items` rows with deterministic session mapping where possible.
5. Migrate `chat-projection.ts` from `message_type = "action_card"` to `message_type = "system"` with lightweight notification metadata.
6. Rename `updateLatestActionCardProjectionStatus` to `updateLatestWorkflowProjectionStatus`.
7. Move Inbox session context source to `workflow_items.session_id` (not action-card metadata).
8. Auto-bind `session.context_label` on first workflow_item creation per session.

Out of scope:

1. Canvas artifact preview/editor (S5c).
2. New domain tables (`work_items`, `artifacts`, `artifact_links`).
3. Lock scope migration (`org` -> `session`).
4. Queue execution model migration to per-session workers.
5. Mobile/narrow layout.
6. Orchestrator v2 campaign search/reuse flow (future phase).

## 3) Database Changes

### 3.1 Migration: `workflow_items` Extension

```sql
ALTER TABLE public.workflow_items
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES orchestrator_sessions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS display_title text;

CREATE INDEX IF NOT EXISTS idx_workflow_items_session
  ON public.workflow_items (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;
```

### 3.2 Migration: `orchestrator_sessions` Extension

```sql
ALTER TABLE public.orchestrator_sessions
  ADD COLUMN IF NOT EXISTS context_label text;
```

- `context_label` stores the auto-detected work context for the session (e.g., activity_folder name).
- Populated on first workflow_item creation; not updated on subsequent items to keep it stable.

### 3.3 Backfill Strategy

- Target: `workflow_items` only (campaigns/contents do not have `session_id`).
- Deterministic priority (must be stable and rerunnable):
  1. `workflow_items`: `origin_chat_message_id -> chat_messages.id -> chat_messages.session_id` (highest priority).
  2. `workflow_items` fallback: nearest `chat_messages` in same org by `created_at` (tie-breaker: latest message before workflow item create time).
- Remaining rows without deterministic mapping: leave `session_id = NULL` (column remains nullable for compatibility).
- Backfill SQL must be idempotent: update only rows with `session_id IS NULL`.
- Add migration comments documenting tie-break rules to prevent environment-dependent outcomes.
- `context_label` backfill for sessions: derive from first `workflow_items` row per session (by `created_at ASC`), using `activity_folder` from the linked campaign's record. Best-effort; leave NULL if unmappable.

### 3.4 Session Deletion Policy

- To preserve auditability, avoid hard-delete of `orchestrator_sessions` in runtime flows.
- If deletion is required, enforce explicit operator migration flow before delete (not silent nulling).
- `ON DELETE RESTRICT` is selected to protect provenance integrity.

## 4) Backend Projection Migration

### 4.1 Chat Projection Change

**File**: `apps/api/src/orchestrator/chat-projection.ts`

Change `emitCampaignActionCardProjection` and `emitContentActionCardProjection`:

- Insert with `messageType: "system"` instead of `"action_card"`.
- Keep `content` field as human-readable summary text (notification body).
- Replace full `WorkflowActionCardMetadata` with lightweight notification metadata:
  ```typescript
  {
    notification_type: "workflow_proposed",
    workflow_item_id: string,
    card_type: "campaign_plan" | "content_draft",
    display_title: string
  }
  ```
- Keep `workflow_item_id` column population for audit/debug traceability.
- Keep `projectionKey` for idempotency.

### 4.2 Status Update Change

**File**: `apps/api/src/orchestrator/chat-projection.ts`

Rename and update `updateLatestActionCardProjectionStatus` -> `updateLatestWorkflowProjectionStatus`:

- For new system notification messages: update notification metadata with resolved status only (lightweight).
- For legacy action_card messages still in DB: keep existing patch logic as fallback for backward compatibility.
- Keep both message types supported during transition window (mixed old/new rows expected).

### 4.3 Transition Safety (Mixed Projection Data)

- During rollout, `action_card` and `system` projection rows will coexist.
- Inbox must stop deriving session context from action-card metadata before projection switch.
- Source-of-truth order for Inbox context:
  1. `workflow_items.session_id` (primary).
  2. Legacy action-card metadata (temporary fallback only until migration cutover complete).
  3. Unresolved -> explicit unknown-session badge.
- Remove legacy metadata fallback only after production data confirms `workflow_items.session_id` coverage.

### 4.4 Orchestrator Step Updates

**Files**:
- `apps/api/src/orchestrator/steps/campaign.ts`
- `apps/api/src/orchestrator/steps/content.ts`

- Pass `session_id` when creating `workflow_items` records.
- Pass `display_title` when creating `workflow_items`:
  - Campaign workflow items: `activity_folder` value (e.g., "봄_프로모션_2026").
  - Content workflow items: `activity_folder + " · " + channel` (e.g., "봄_프로모션_2026 · instagram").
- On first workflow_item creation per session: update `orchestrator_sessions.context_label = activity_folder` if `context_label IS NULL`.

### 4.5 `display_title` Generation Rules

| Workflow Item Type | `display_title` Formula | Example |
|---|---|---|
| `campaign_plan` | `activity_folder` | `"봄_프로모션_2026"` |
| `content_draft` | `activity_folder + " · " + channel` | `"봄_프로모션_2026 · instagram"` |
| Fallback (missing data) | First user message substring (max 50 chars) | `"인스타 콘텐츠 만들어줘"` |

## 5) Frontend Updates

### 5.1 InboxPanel Enhancement

**File**: `apps/desktop/src/components/workspace/InboxPanel.tsx`

- Display `display_title` from workflow items when available (fallback to generated title).
- Show session context badge (originating session info) per Inbox item using `workflow_items.session_id` join.
- Replace action-card-metadata-based `sessionId` extraction with `workflow_items.session_id` lookup.

### 5.2 WorkspaceChatPanel Update

**File**: `apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx`

- Render `message_type === "system"` notification messages as lightweight notification bubbles.
- Notification bubble shows: summary text + "View in Inbox" action link.
- Keep `message_type !== "action_card"` filter for legacy rows.
- "View in Inbox" action must navigate with query contract:
  - `/workspace?panel=inbox&workflowItemId=<id>&sessionId=<session_id>`
  - Inbox opens item detail and syncs active session rail state when `sessionId` is present.

### 5.3 AgentChatWidget Update

**File**: `apps/desktop/src/components/AgentChatWidget.tsx`

- Same system notification rendering as WorkspaceChatPanel (lightweight bubble).

### 5.4 Session Rail Update

**File**: `apps/desktop/src/components/workspace/SessionRailPanel.tsx`

- Display `context_label` as session title when available.
- Fallback to existing title logic (first message preview) when `context_label` is NULL.

### 5.5 Type Updates

**File**: `packages/types/src/index.ts`

- Add `session_id?: string` and `display_title?: string` to `WorkflowItem` type.
- Add `context_label?: string` to session-related type.
- Add `SystemNotificationMetadata` type for the new notification metadata shape.

## 6) Implementation Sequence

1. **Database migration** — add `session_id` + `display_title` to `workflow_items`, `context_label` to `orchestrator_sessions`, indexes, deterministic backfill.
2. **Type contract updates** — add new fields to shared types.
3. **Orchestrator step updates** — pass `session_id`, `display_title` on workflow_item creation; auto-bind `context_label` on first item per session.
4. **Inbox data-source cutover** — switch Inbox session context to `workflow_items.session_id`.
5. **Projection status updater refactor** — rename to `updateLatestWorkflowProjectionStatus` with dual-format support.
6. **Chat projection migration** — change `message_type` from `action_card` to `system`.
7. **Frontend notification rendering** — system message bubbles with "View in Inbox" link contract.
8. **Session Rail context_label display** — show auto-tagged session label.
9. **Legacy fallback review** — verify coverage and reduce action-card metadata dependency.

### 6.1 Rollout and Rollback Notes

- Rollout supports mixed data (`action_card` + `system`) to avoid deployment-order breakage.
- If partial deployment fails, keep old action-card projection writer disabled only after Inbox and status updater are confirmed dual-compatible.
- Rollback approach:
  1. Keep schema columns (non-breaking additive migration).
  2. Re-enable legacy projection writer if needed.
  3. Preserve dual-read logic until forward fix is deployed.

## 7) Validation Plan

Automated:

1. `pnpm type-check` — required PASS gate.
2. Migration SQL integrity checks — required PASS gate:
   - FK/index presence on `workflow_items.session_id`.
   - Backfill idempotency (`session_id IS NULL`-guarded updates).
   - `context_label` column presence on `orchestrator_sessions`.
3. `pnpm supabase:db:push` (local) — best effort when local engine is available.
4. `pnpm smoke:1-5a` — best effort.
5. `pnpm smoke:s3` — deferred/optional in environments without Docker/Supabase local engine.

Manual QA:

1. New workflow items have `session_id` and `display_title` populated.
2. `display_title` follows generation rules (activity_folder based, with channel suffix for content items).
3. Session `context_label` is auto-set on first workflow_item creation.
4. Chat timeline shows system notification messages (not action cards) for new workflow proposals.
5. Legacy action_card messages remain hidden from timeline (client-side filter still active).
6. Inbox items display `display_title` and session context from `workflow_items.session_id`.
7. "View in Inbox" link in notification bubble navigates correctly.
8. Session Rail shows `context_label` as session title when available.
9. Mixed projection period (`action_card` + `system`) does not break Inbox session context resolution.

## 8) Acceptance Criteria

1. `workflow_items` table has `session_id` column with FK (`ON DELETE RESTRICT`) and partial index.
2. `workflow_items` has `display_title` column populated for new records per generation rules.
3. `orchestrator_sessions` has `context_label` column, auto-populated on first workflow_item per session.
4. `campaigns` and `contents` tables do NOT have `session_id` (session provenance is via `workflow_items` join).
5. Backend projection emits `message_type = "system"` instead of `"action_card"` for new workflow proposals.
6. System notification messages render as lightweight bubbles in chat timeline.
7. Existing legacy action_card data remains safe and hidden.
8. Inbox rendering leverages `display_title` and session provenance from `workflow_items.session_id`.
9. Function rename (`updateLatestWorkflowProjectionStatus`) is completed with legacy compatibility retained.
10. Session Rail displays `context_label` for auto-tagged sessions.
11. Required gates (`type-check` + SQL integrity checks) pass; smoke tests run when environment permits.
