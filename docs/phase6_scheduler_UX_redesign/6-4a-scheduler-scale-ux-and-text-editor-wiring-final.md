# Phase 6-4A: Scheduler Scale UX + Text Editor Wiring

- Date: 2026-03-05
- Status: Planning (final draft)
- Scope: High-density scheduler rendering, cross-window reschedule behavior, and text editor workflow integration on top of 6-3A contracts
- Depends on: Phase 6-3A
- Maps to: Architecture doc Section 11 (S-3)

---

## 1) Why 6-4A exists

After 6-3A, scheduler data is reliable. The next risk is interaction scale:
- month/list can overload with many items,
- drag-reschedule can move items outside active windows,
- editor actions must stay consistent with slot/workflow/content status contracts.

6-4A addresses UX scale and editing workflows without breaking data integrity.

---

## 2) Goals

1. Dense month/list usability with pagination and virtualization.
2. Safe drag-reschedule behavior when target date is outside current window.
3. Text editor save/approve/revise flow wired to canonical slot transitions.
4. Realtime-compatible UI updates that coexist with optimistic interactions.
5. Keep behavior robust under offline/reconnect conditions.

---

## 3) Data and API Extensions

### 3.1 Reuse 6-3A cursor contract

Use `cursor + limit` from `GET /scheduled-content` for list and day detail expansion.
Do not rely on large fixed `limit` payloads.

### 3.2 Day-detail endpoint (recommended)

Add:
`GET /orgs/:orgId/scheduled-content/day?date=YYYY-MM-DD&timezone=...&cursor=...&limit=...`

Purpose:
- load heavy days lazily from month view
- keep month grid lightweight

### 3.3 Reschedule endpoint

Add:
`PATCH /orgs/:orgId/schedule-slots/:slotId/reschedule`

Request:

```json
{
  "target_date": "2026-03-20",
  "target_time": "2026-03-20T09:00:00+07:00",
  "timezone": "Asia/Bangkok",
  "idempotency_key": "uuid"
}
```

Response includes:
- updated slot row,
- whether source window and destination window changed,
- server-resolved timezone metadata.

---

## 4) Month/List High-Density UX

### 4.1 Month grid strategy

- each day cell renders top `N` items only (`N=3` default)
- show `+X more` indicator when overflow exists
- clicking overflow opens Day Detail Drawer

### 4.2 Day Detail Drawer

- virtualized list rendering
- cursor-based infinite load
- server-side sorting consistent with board contract

### 4.3 List view strategy

- window query + cursor pagination
- infinite scroll or explicit `Load more`
- preserve scroll position across filter changes where possible

---

## 5) Drag-Reschedule Strategy (Window-Aware)

### 5.1 Optimistic interaction policy

On drag drop:
1. optimistic UI move in current view
2. call reschedule API
3. reconcile with server response

### 5.2 Outside-window target behavior

If moved outside current date window:
- remove card from current window after success
- show toast with destination date and quick jump action
- invalidate current window query
- prefetch destination window optionally (if user likely to navigate)

### 5.3 Failure and offline handling

- rollback optimistic move on API failure
- if offline, block drag-reschedule and show reason
- retry path allowed only when back online

---

## 6) Text Editor Wiring (6-4A scope)

### 6.1 Direct save

- Save body without auto-approval
- optimistic concurrency via `expected_updated_at`
- keep status unchanged on plain save

### 6.2 Approval/revision actions

- editor actions call workflow APIs
- slot status updates only via canonical transition helper from 6-3A
- realtime + soft-refetch reconciles badge/state changes

### 6.3 Context-aware regenerate via chat

- editor sets `uiContext.focusContentId`
- regenerate requests route through chat with content context
- final persisted edit appears back in editor via realtime/refetch

---

## 7) Realtime and State Consistency

1. continue `updated_at` guard for merge safety.
2. keep periodic soft refetch enabled.
3. do not trust optimistic state as final until server ack.
4. reconnect always triggers refetch of active window.

---

## 8) Acceptance Criteria

1. Month view remains readable for heavy days using `top N + more` pattern.
2. Day Detail Drawer supports virtualized rendering and cursor loading.
3. List view supports cursor pagination (not limit-only).
4. Drag-reschedule updates UI correctly for both in-window and out-of-window targets.
5. Out-of-window moves trigger query invalidation and destination guidance.
6. Direct save in editor persists body without changing approval status.
7. Approve/revise/reject from editor reflects slot/workflow/content states consistently.
8. Offline mode blocks unsafe mutations but keeps read-only visibility.
9. Reconnect restores consistency through refetch and realtime resubscription.

---

## 9) Verification Plan

1. `pnpm --filter @repo/api type-check`
2. `pnpm --filter desktop type-check`
3. `pnpm --filter @repo/api test:unit`
4. Manual: stress month view with heavy test data and verify overflow behavior.
5. Manual: day drawer infinite load and virtualization smoothness.
6. Manual: drag to outside window and verify remove/invalidate/jump behavior.
7. Manual: direct save + approve/revise flows from editor under realtime on/off.
8. Manual: offline, reconnect, and token refresh scenarios.

---

## 10) Files to Modify (6-4A)

- `apps/api/src/routes/sessions.ts`
- `apps/api/src/scheduler/queries/list-scheduled-content-day.ts` (new, optional but recommended)
- `apps/api/src/orchestrator/service.ts`
- `apps/desktop/src/pages/Scheduler.tsx`
- `apps/desktop/src/components/scheduler/SchedulerBoard.tsx`
- `apps/desktop/src/components/scheduler/MonthView.tsx`
- `apps/desktop/src/components/scheduler/DayDetailDrawer.tsx` (new)
- `apps/desktop/src/components/scheduler/ContentEditor.tsx`
- `apps/desktop/src/components/scheduler/CaptionEditor.tsx` (new)
- `apps/desktop/src/components/scheduler/BlogEditor.tsx` (new)
- `apps/desktop/src/components/chat/GlobalChatPanel.tsx`

---

## 11) Delivery Note

6-4A must not bypass 6-3A guardrails:
- no direct slot status writes outside transition helper,
- no limit-only large fetches for dense views,
- no merge-only realtime without refetch fallback,
- no implicit timezone math.