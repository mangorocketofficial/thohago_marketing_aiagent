# Phase 6-3A: Scheduler Data Integration Core

- Date: 2026-03-05
- Status: Planning (final draft)
- Scope: Production-safe scheduler data contract, filtering, status sync, realtime resilience, and connectivity hardening
- Depends on: Phase 6-2 (scheduler shell + schedule_slots schema)
- Unlocks: Phase 6-4A (dense views, drag-reschedule UX, text editor wiring)
- Maps to: Architecture doc Section 11 (S-2)

---

## 1) Why 6-3A exists

Phase 6-2 shipped the scheduler shell, but data behavior is still fragile:
- large datasets are fetched as flat lists,
- status updates can drift across multiple backend mutation paths,
- realtime-only merge can become stale on reconnect,
- timezone edges can create wrong week/month boundaries,
- filters and connectivity states are not resilient enough for daily operation.

6-3A hardens these foundations before feature expansion.

---

## 2) Goals

1. Date-window and server-side filter contract for scheduler data.
2. Cursor pagination support (not limit-only) for scale safety.
3. Canonical slot status transitions enforced by one helper/transition table.
4. Realtime sync with ordering guard (`updated_at`) and periodic soft refetch.
5. Clear offline and reconnect behavior (graceful degradation).
6. Debounced filters with loading state, request cancellation, and race prevention.
7. Explicit timezone contract across API and desktop.
8. Scheduler campaign summary query moved out of `rag/data.ts` into scheduler domain module.

---

## 3) Split Scope: 6-3A vs 6-4A

In 6-3A:
- API contract and backend query rewrite
- status sync hardening
- realtime resilience and fallback pull
- connectivity and filter UX resilience
- timezone correctness

Deferred to 6-4A:
- month/day high-density rendering UX
- drag-reschedule cross-window behavior
- full text editor interaction expansion

---

## 4) API Contract (Revised)

### 4.1 `GET /orgs/:orgId/scheduled-content`

Query params:
- `start_date` (`YYYY-MM-DD`, inclusive)
- `end_date` (`YYYY-MM-DD`, inclusive)
- `timezone` (IANA, e.g. `Asia/Bangkok`; default: org timezone)
- `campaign_id` (`uuid` or `adhoc`)
- `channel` (exact)
- `status` (exact slot status)
- `limit` (default `200`, max `500`)
- `cursor` (opaque cursor for stable pagination)

Response:

```json
{
  "ok": true,
  "items": [],
  "page": {
    "next_cursor": "opaque-or-null",
    "has_more": true
  },
  "query": {
    "timezone": "Asia/Bangkok",
    "start_date": "2026-03-03",
    "end_date": "2026-03-09"
  }
}
```

Ordering for cursor stability:
- `scheduled_date ASC`
- `scheduled_time ASC NULLS LAST`
- `id ASC`

### 4.2 `GET /orgs/:orgId/campaigns/active-summaries`

Moved to scheduler domain query layer.
Returns lightweight list for filters:

```json
{ "ok": true, "items": [{ "id": "uuid", "title": "Campaign title" }] }
```

---

## 5) Backend Design

### 5.1 Scheduler query module separation

Create scheduler-scoped query modules:
- `apps/api/src/scheduler/queries/list-scheduled-content.ts`
- `apps/api/src/scheduler/queries/list-active-campaign-summaries.ts`

Do not add this to `apps/api/src/rag/data.ts`.

### 5.2 Canonical slot status transition engine

Single source of truth for slot status updates:
- `apps/api/src/orchestrator/scheduler-slot-transition.ts`

All paths (`service.ts`, `steps/content.ts`, publish flow, retry flow) must call this module only.

Transition table example:
- `GENERATION_STARTED -> generating`
- `GENERATION_COMPLETED -> pending_approval`
- `WORKFLOW_APPROVED -> approved`
- `WORKFLOW_REJECTED -> skipped`
- `WORKFLOW_REVISION_REQUESTED -> pending_approval`
- `CONTENT_PUBLISHED -> published`
- `GENERATION_FAILED/PUBLISH_FAILED -> failed`

The helper validates allowed transitions and rejects invalid direct jumps.

### 5.3 Realtime + soft-refetch consistency

Realtime payload merge rule:
- apply only if incoming `updated_at > local.updated_at`
- ignore older/stale events

Fallback refresh triggers:
- every 45 seconds soft refetch (configurable 30-60 seconds)
- immediately after reconnect
- immediately after foreground regain (window focus)

---

## 6) Desktop Behavior

### 6.1 Filter UX resilience

- Debounce filter changes by 250ms.
- Show loading state while query is in flight.
- Use abort/cancel for superseded requests.
- Keep previous data visible (stale-while-revalidate) to avoid flash.

### 6.2 Connectivity degradation

Expose connection state in scheduler UI:
- `online`
- `reconnecting`
- `offline`

Offline behavior:
- board remains readable from last successful fetch
- mutating actions are disabled with clear reason
- auto-retry and refetch when back online

### 6.3 Electron realtime feasibility

Supabase Realtime is supported in Electron renderer (WebSocket via `@supabase/supabase-js`).

Policy:
- subscribe in renderer, not main process
- guard against duplicate subscriptions on remount
- resubscribe on token refresh/session change
- keep polling fallback enabled even when realtime is active

---

## 7) Timezone Contract

Server and client must use the same timezone source:
1. explicit request `timezone`, else
2. org timezone from settings, else
3. `UTC` fallback.

Window math rules:
- week/month boundaries are computed in the resolved timezone
- server returns resolved timezone and resolved window in response
- desktop renders headers using returned timezone context

---

## 8) Tests and Validation

Required:
1. `pnpm --filter @repo/api type-check`
2. `pnpm --filter desktop type-check`
3. `pnpm --filter @repo/api test:unit`

New unit tests:
- date range inclusive behavior with timezone boundaries
- filter combinations and `campaign_id=adhoc`
- cursor pagination stability
- transition-table valid/invalid transitions
- stale realtime event rejection by `updated_at`

Manual checks:
- offline mode and reconnect recovery
- fast filter toggling race safety
- realtime on/off fallback continuity

---

## 9) Acceptance Criteria

1. Scheduler requests date windows server-side for week/month/list.
2. Campaign/channel/status filters are applied server-side.
3. Cursor pagination works and is stable under sorted order.
4. Slot status can only change through canonical transition helper.
5. Realtime merge ignores stale events and periodic soft refetch keeps data clean.
6. Offline/reconnect states are visible and non-destructive.
7. Filter interactions are debounced and race-safe.
8. Timezone is explicit and boundary-correct in API and desktop.
9. Active campaign summaries are served from scheduler/campaign query module, not RAG module.

---

## 10) Files to Modify (6-3A)

- `apps/api/src/routes/sessions.ts`
- `apps/api/src/scheduler/queries/list-scheduled-content.ts` (new)
- `apps/api/src/scheduler/queries/list-active-campaign-summaries.ts` (new)
- `apps/api/src/orchestrator/scheduler-slot-transition.ts` (new)
- `apps/api/src/orchestrator/service.ts`
- `apps/api/src/orchestrator/steps/content.ts`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/src/global.d.ts`
- `apps/desktop/src/pages/Scheduler.tsx`
- `apps/desktop/src/components/scheduler/SchedulerFilters.tsx`

---

## 11) Follow-up to 6-4A

6-4A consumes this stable data layer for:
- month/day dense rendering with virtualization,
- drag-reschedule cross-window updates,
- advanced editor flows.