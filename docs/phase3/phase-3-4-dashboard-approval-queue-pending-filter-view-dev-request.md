# Phase 3-4 Development Plan
## Convert Dashboard Approval Surfaces to Pending Read-Only View + Chat Handoff

---

## Goal

Reduce Dashboard approval surfaces to non-mutating visibility views and remove duplicate decision paths now that chat action-cards are fully interactive.

This phase establishes:

- One primary decision surface: chat action-cards.
- Dashboard Campaign Approval and Approval Queue as read-only monitor views.
- Clear navigation from dashboard rows/cards to corresponding chat workflow context.
- Backward-safe removal of duplicate dashboard approve/reject/edit controls.

---

## Why This Phase

Phase 3-3 introduced inline approve/revise/reject handling in chat action-cards with workflow-version safety.
Dashboard still exposes overlapping approval controls in two places:

- Campaign Approval section (`Approve Campaign`, `Reject Campaign`)
- Approval Queue (`Approve`, `Reject`, editable body textarea)

Phase 3-4 closes that UX/control-plane duplication by making chat the only execution surface and keeping dashboard as an operational visibility surface.

This enables:

- reduced state mismatch risk between dashboard and chat
- lower cognitive load for operators
- cleaner transition to later bulk-action and workflow analytics phases

---

## Design Principles

1. `workflow_items` remains the canonical state machine.
2. Chat action-cards remain the only place where approval actions execute.
3. Dashboard Campaign Approval + Approval Queue become non-mutating and focus on visibility/handoff.
4. Pending rows/cards should deep-link users to actionable chat context quickly.
5. Contract safety and backward compatibility are maintained at API/IPC boundaries.
6. Removal of duplicate buttons must not degrade operator observability.

---

## Scope

### In Scope

- Dashboard Campaign Approval + Queue conversion to read-only view:
  - remove campaign `Approve Campaign` / `Reject Campaign` buttons
  - remove queue-side `Approve` / `Reject` buttons
  - remove queue-side inline content edit textarea
  - keep metadata summary (channel, created time, campaign reference, status)
- Pending filter semantics:
  - primary filter: `contents.status = 'pending_approval'`
  - optional workflow status/version badge when linked workflow item is available
- Navigation handoff:
  - add `Open in Chat` action for campaign card and each queue row
  - pass best-effort handoff context (`workflow_item_id`, campaign/content id hints)
  - in Agent Chat, consume handoff and scroll/highlight related action-card when found
- App-level state cleanup:
  - remove duplicated dashboard mutation handlers no longer used by dashboard UI
  - remove now-unused queue edit state hook (`usePendingApprovals`)
  - retain underlying runtime IPC APIs for compatibility (not hard-removed in 3-4)
- Validation updates:
  - ensure no dashboard-side mutation path remains in dashboard UI
  - compile-time guarantee by removing mutation props from `DashboardPageProps`
  - ensure chat-side path still completes full approve/revise/reject cycle

### Out of Scope

- Full IPC endpoint removal for legacy queue actions.
- Telegram queue/action redesign.
- Bulk queue operations redesign.
- Major dashboard visual redesign unrelated to duplicate-path removal.

---

## Current Baseline (Post Phase 3-3)

- Chat timeline supports interactive `action_card` approval actions.
- Dashboard still renders campaign + queue action controls:
  - Campaign Approval buttons (`Approve Campaign`, `Reject Campaign`)
  - Queue action controls (`Approve`, `Reject`, editable body)
- Duplicate action routes exist:
  - chat inline actions
  - dashboard campaign/queue action buttons

Gap:

- Decision execution is still split between two UI surfaces.

---

## Target Interaction Model

### 1) Dashboard = Read-Only Monitor + Handoff

Campaign card shows:

- campaign summary metadata
- current workflow badge when available
- `Open in Chat` action

Campaign card does **not** show:

- approve/reject action controls

Queue rows show:

- content/channel/type summary
- campaign and timestamp metadata
- current pending state + optional workflow badge
- `Open in Chat` affordance

Queue rows do **not** show:

- approve/reject buttons
- request revision buttons
- edited-body input controls

### 2) Agent Chat = Decision Surface

All approve/revise/reject execution remains in chat action-cards only.

### 3) Navigation Contract

From dashboard queue row:

- navigate to Agent Chat page
- pass handoff hint via navigation options:
  - `focusWorkflowItemId?: string`
  - `focusContentId?: string`
  - `focusCampaignId?: string`
- if exact card focus is not available, still land in chat timeline for same session/org context

From campaign card:

- same `Open in Chat` contract, campaign-focused hints when available

---

## Data / Contract Changes

### 1) Desktop UI (`apps/desktop/src`)

- `Dashboard.tsx`
  - remove campaign/queue mutate controls
  - add `Open in Chat` handoff actions for campaign card and pending rows
  - render pending metadata + workflow badge only
- `App.tsx`
  - remove unused dashboard mutation wiring (`approveCampaign`, `rejectCampaign`, `approveContent`, `rejectContent`)
  - remove `usePendingApprovals` usage + related props/state
  - keep chat `dispatchAction` path unchanged
- `NavigationContext.tsx`
  - store handoff payload in navigation state
  - expose clear/consume capability after chat focus
- `AgentChat.tsx`
  - consume handoff payload and focus matching action-card (scroll + transient highlight)
- optional linkage lookup:
  - map dashboard campaign/content entries to workflow item id via best-effort linkage data

### 2) Shared Types (`packages/types`)

- no backend schema migration required
- add/extend navigation handoff type contract for dashboard->chat focus hints

### 3) IPC / Backend

- no mandatory backend schema migration required
- keep existing IPC approve/reject handlers for backward safety in 3-4
- mark legacy queue action routes for future deprecation in later phase

---

## Delivery Plan

### 1) Dashboard Read-Only Refactor

- Convert campaign + queue panels to read-only visibility view.
- Remove dashboard-side action buttons and inline edit controls.
- Preserve key metadata and list usability.

### 2) Dashboard-to-Chat Handoff

- Add `Open in Chat` action on campaign card and each pending row.
- Wire to navigation context/tab switching.
- Pass best-effort workflow/content/campaign hints.
- In chat renderer, attempt focus/scroll/highlight of matched action-card.

### 3) App Wiring Cleanup

- Remove now-unused dashboard mutation callbacks from dashboard page props.
- Remove `usePendingApprovals` hook and queue edit state path.
- Keep chat action dispatch path untouched and primary.

### 4) Validation

- Verify dashboard cannot trigger approve/revise/reject mutations anymore.
- Verify `DashboardPageProps` no longer exposes mutation callbacks (compile-time safety).
- Verify pending item can still be fully resolved via chat.
- Verify pending queue updates reflect realtime status transitions.

---

## Target File Updates

- `apps/desktop/src/pages/Dashboard.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/pages/AgentChat.tsx`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/context/NavigationContext.tsx`
- `apps/desktop/src/types/navigation.ts`
- `apps/desktop/src/hooks/usePendingApprovals.ts` (remove)

---

## Acceptance Criteria

1. Dashboard Campaign Approval and Approval Queue no longer expose approve/reject/edit controls.
2. Dashboard campaign/queue panels render as visibility + `Open in Chat` handoff only.
3. Each campaign card/pending queue row has a working `Open in Chat` handoff.
4. Navigation contract supports handoff hints (`focusWorkflowItemId`, campaign/content id hints).
5. Agent Chat attempts workflow-card focus (scroll/highlight) when handoff hint is provided.
6. `DashboardPageProps` no longer contains dashboard mutation callbacks (compile-time guard).
7. Approval decisions can still be completed end-to-end through chat action-cards.
8. No behavioral regression in chat inline action path from Phase 3-3.
9. `pnpm --filter @repo/desktop type-check` passes.
10. Existing smoke flow remains green (`pnpm smoke:1-5a`).

---

## Risks and Controls

| Risk | Impact | Control |
|---|---|---|
| Operators accustomed to queue buttons feel blocked | transition friction | clear queue labels and direct `Open in Chat` CTA |
| Queue-to-chat context jump feels imprecise | slower decision handling | handoff contract + best-effort workflow linkage + visible focus highlight |
| Hidden dependency on removed callbacks | runtime regressions | remove props/callbacks incrementally with type-check gates |
| Legacy integration still calls old IPC actions | compatibility concern | keep IPC endpoints intact in 3-4, deprecate later |

---

## Definition of Done for Phase 3-4

- Dashboard campaign + queue surfaces are reduced to read-only monitoring views.
- Duplicate dashboard decision path is removed from UI.
- Chat action-cards are the single operational approval path.
- Phase is ready for explicit legacy action-route deprecation planning.

---

*Document version: v1.1*  
*Phase: 3-4*  
*Title: Dashboard Read-Only Pending View + Chat-Only Decision Path*  
*Created: 2026-03-03*

