# Step S3 Development Plan (Session-Scoped Chat Data Cutover)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S3
- Status: Revised draft for implementation

## 1) Objective

Cut over desktop chat data from org-scoped reads/subscriptions to session-scoped reads/subscriptions using `selectedSessionId` as the primary timeline boundary.

S3 must remove cross-session timeline mixing while preserving S1/S2 behavior and resume/idempotency safety.

## 2) Current State Snapshot (As of 2026-03-04)

Completed:

1. S1 foundation is complete:
   - workspace-aware sessions
   - session list/create/recommended APIs
   - `chat_messages.session_id` foundation with nullable rollout
2. S2 baseline implementation is in place:
   - `SessionSelectorContext` introduced
   - mini chat selector bar + review-all modal + recommended switch UI
   - selected-session based send/action guards in `ChatContext`

Known gaps/risks still visible:

1. Message query/subscription is still org-scoped in runtime behavior (timeline mixing risk remains).
2. Legacy compatibility paths (`activeSession`) are visible in dashboard/settings without explicit compatibility labeling.
3. Local dev instability observed from environment mismatch:
   - stale renderer process on `5173`
   - `ORCHESTRATOR_API_BASE` not aligned with running API port, causing `HTTP 404` on chat/session calls.

## 3) S3 Scope

In scope:

1. Change chat timeline reads to `org_id + session_id=selectedSessionId`.
2. Change chat realtime subscriptions to session-scoped filters and rebind on selection change.
3. Ensure chat UI behavior is strictly selected-session aware:
   - no selected session -> empty timeline + send disabled
   - switching session -> timeline clear + rebinding without cross-session residue
4. Keep action-card dispatch/session mismatch safeguards strict.
5. Add minimal read-only legacy entrypoint in Agent Chat (`Legacy messages`) for `session_id IS NULL` rows.
6. Keep dashboard/settings `activeSession` display but explicitly label it as compatibility-only.
7. Add strict dev-environment preflight and fail-fast behavior for API port/base-url mismatch.
8. Add S3-specific validation (automated + manual) for session isolation and switch-time realtime safety.

Out of scope:

1. Lock scope migration (`org` -> `session`).
2. Queue execution model migration to per-session workers.
3. Full Agent Chat session-hub redesign (S4).
4. Hard DB migration to `chat_messages.session_id NOT NULL` (later hardening phase).
5. Full legacy timeline migration UX beyond minimal read-only fallback entrypoint.

## 4) Product Rules (Must Hold)

1. `selectedSessionId` is the source of truth for timeline content.
2. Page navigation must not switch session automatically.
3. Recommendation remains advisory only (explicit user switch).
4. No cross-session message/action writes are allowed.
5. Session switch/new-session operations remain explicit user actions.
6. Session switch must clear visible timeline immediately before new session timeline is loaded.
7. `session_id IS NULL` rows are excluded from normal timeline by default.
8. `activeSession` is compatibility-only metadata and must not control timeline reads.

## 5) Data Read/Subscription Strategy

### 5.1 Message read strategy

1. Current read:
   - `chat_messages` filtered by `org_id` only.
2. S3 read:
   - `chat_messages` filtered by `org_id` and `session_id = selectedSessionId`.
3. If `selectedSessionId` is null:
   - do not read full org timeline
   - show actionable empty state.

### 5.2 Realtime strategy

1. Create session-scoped realtime channel filter:
   - `org_id=eq.<orgId>,session_id=eq.<selectedSessionId>`
2. On session change:
   - clear stale in-memory timeline immediately
   - unsubscribe previous session channel
   - subscribe new session channel
   - load snapshot for the newly selected session
3. Realtime safety:
   - bind channel callbacks with session/request token
   - ignore late callbacks when token/session does not match latest selection.

### 5.3 Legacy/null message handling

1. Default S3 behavior excludes `session_id IS NULL` rows from normal timeline.
2. Add explicit Agent Chat entrypoint:
   - `Legacy messages` link/button
   - read-only list scoped by `org_id` and `session_id IS NULL`
   - no send, no action-card dispatch from legacy view.
3. Full legacy handling UX remains deferred to S4/hardening.

### 5.4 Non-chat table strategy in S3

1. `chat_messages` subscription/query becomes session-scoped.
2. `campaigns` and `contents` subscriptions remain org-scoped in S3 for dashboard queue visibility.
3. Session-switch rebind is applied only to message timeline channel to reduce unnecessary resubscription churn.

## 6) Architecture Plan

### 6.1 Core ownership

1. `SessionSelectorContext` owns session identity and selection lifecycle.
2. `ChatContext` consumes selected-session identity and owns timeline query/subscription behavior.
3. Timeline clear/rebind responsibility stays in `ChatContext` (not in `SessionSelectorContext`).
4. `activeSession` remains compatibility-only and must not control timeline reads.

### 6.2 Race safety

1. Session switch timeline loads use last-write-wins request tokens.
2. Late query/subscription callbacks from previous session are ignored.
3. Action dispatch is blocked while `isSessionMutating=true`.
4. Session-switch path enforces deterministic order:
   - clear -> unsubscribe -> subscribe -> snapshot apply.

### 6.3 Compatibility display policy

1. Dashboard/settings keep `activeSession` fields in S3.
2. UI labels explicitly mark them as compatibility-only.
3. Removal target is S4 cleanup once session-scoped UX is fully stabilized.

## 7) Environment Hardening (Pre-Implementation Gate)

Before S3 validation begins, enforce:

1. Renderer port availability:
   - no stale listener on `5173`.
2. Canonical local convention (aligned with current repo defaults):
   - `API_PORT=3001`
   - `ORCHESTRATOR_API_BASE=http://127.0.0.1:3001`
   - `PIPELINE_TRIGGER_ENDPOINT=http://127.0.0.1:3001/trigger`
3. Non-default port usage (for example `3002`) is allowed only when all three values are aligned consistently.
4. Strict fail-fast in desktop dev bootstrap:
   - if `ORCHESTRATOR_API_BASE` is unset, derive from `API_PORT`
   - if `ORCHESTRATOR_API_BASE` port mismatches effective `API_PORT`, emit `console.error` and `process.exit(1)`
   - keep `PIPELINE_TRIGGER_ENDPOINT` derived from final base when unset.

## 8) File-Level Plan

1. `apps/desktop/src/context/ChatContext.tsx`
   - cut over timeline query to selected-session filter
   - split message channel to session-scoped rebinding
   - keep non-message channels (`campaigns`, `contents`) org-scoped
   - implement clear -> unsubscribe -> subscribe sequence
   - add stale response/token guard for switch-time callbacks
2. `apps/desktop/src/context/SessionSelectorContext.tsx`
   - keep selection lifecycle and `isSessionMutating` authoritative
   - expose any narrow selection-change signal only if needed by `ChatContext`
   - do not own timeline clear logic
3. `apps/desktop/src/pages/AgentChat.tsx`
   - ensure selected-session empty state and disabled controls stay aligned
   - add read-only `Legacy messages` entrypoint/view
4. `apps/desktop/src/components/AgentChatWidget.tsx`
   - ensure widget list reflects selected-session timeline only
   - keep no-selection behavior explicit
5. `apps/desktop/src/pages/Dashboard.tsx`
   - label `Active Session`/related runtime fields as compatibility-only
6. `apps/desktop/src/pages/Settings.tsx`
   - label `Active Session`/related runtime fields as compatibility-only
7. `apps/desktop/src/App.tsx`
   - keep compatibility active-session refresh for runtime summary only
8. `apps/desktop/electron/run-dev-electron.mjs`
   - derive fallback base URL from `API_PORT`
   - enforce strict fail-fast on base-url/API-port mismatch
9. `apps/desktop/src/i18n/locales/en.json`
10. `apps/desktop/src/i18n/locales/ko.json`
   - add/adjust copy for session-scoped empty/notice states
   - add copy for `Legacy messages` entrypoint and compatibility-only labels
11. `scripts/smoke-session-s3.mjs` (new)
   - session isolation + switch-time realtime leakage checks.

## 9) Implementation Sequence

1. Apply env hardening/fail-fast patch first (`run-dev-electron.mjs`), confirm clean startup behavior.
2. Implement session-scoped message read cutover in `ChatContext`.
3. Implement session-scoped realtime cutover with deterministic switch order:
   - clear -> unsubscribe -> subscribe -> snapshot.
4. Add stale-response/token protection on switch-time refresh and callback paths.
5. Add Agent Chat `Legacy messages` read-only entrypoint.
6. Add compatibility-only labels for dashboard/settings `activeSession` surfaces.
7. Add i18n keys and UX copy pass.
8. Run full validation checklist and record evidence.

## 10) Validation Plan

Automated:

1. `pnpm type-check`
2. S3 smoke script (new): session isolation + switch-time safety
   - create two sessions (A/B) in same org
   - write events/messages to both
   - verify A selection sees only A timeline
   - verify B selection sees only B timeline
   - switch session while realtime events are incoming and verify previous-session events are ignored
   - verify no normal timeline query includes `session_id IS NULL` rows
3. Existing smoke suites (`smoke:1-5a`, `smoke:2-5a`) for regression safety.

Manual QA:

1. Switching between Session A/B changes timeline content accordingly with no mixing.
2. On session switch, previous timeline clears immediately before new timeline appears.
3. New session starts with empty session timeline (unless existing messages are written to that session).
4. Page navigation does not change selected session.
5. Recommendation only switches on explicit click.
6. Review-all pagination still works after S3 cutover.
7. During session mutating, send/action controls are disabled.
8. `Legacy messages` entrypoint is visible and read-only (no writes/actions).
9. Dashboard/settings show compatibility-only labeling for `activeSession` fields.
10. Misconfigured `ORCHESTRATOR_API_BASE` vs `API_PORT` fails fast at startup (no silent 404 loop).

## 11) Acceptance Criteria (S3)

1. Timeline reads are session-scoped (`selectedSessionId`) and no longer org-global.
2. Realtime updates are session-scoped and resubscribe correctly on session change.
3. Cross-session timeline bleed is eliminated in both mini widget and Agent Chat page.
4. Session switch order ensures stale timeline is cleared immediately and old callbacks are ignored.
5. Selected-session send/action safeguards remain intact.
6. S2 selector capabilities (recent/recommended/new/review-all) remain stable.
7. `Legacy messages` fallback exists as explicit read-only entrypoint and does not contaminate normal timeline.
8. Dashboard/settings `activeSession` remains visible but explicitly marked compatibility-only.
9. Dev bootstrap fails fast on API port/base-url mismatch and avoids hidden 404 debugging traps.
10. S1/S2 compatibility paths still allow safe runtime rollback without data corruption.

## 12) Rollback Plan

1. Keep S2 selector state/features intact.
2. Introduce runtime guard flag:
   - `DESKTOP_CHAT_TIMELINE_SCOPE=session|org` (default: `session` in S3)
3. If S3 regression occurs:
   - set flag to `org`
   - revert message read/subscription path to org-scoped behavior
   - preserve selected-session write guards for send/action dispatch
4. Do not rollback DB schema; rollback is runtime/query-path only.

## 13) Resolved Decisions (Before Merge)

1. Legacy `session_id IS NULL` rows:
   - hidden by default from normal timeline
   - exposed only through explicit read-only `Legacy messages` entrypoint.
2. Dev bootstrap mismatch handling:
   - strict fail-fast (`console.error` + `process.exit(1)`) on `ORCHESTRATOR_API_BASE` vs `API_PORT` inconsistency.
3. `activeSession` visibility in S3:
   - keep in dashboard/settings with compatibility-only labels
   - remove in S4 cleanup.
4. Realtime rebind order:
   - use `clear -> unsubscribe -> subscribe`, plus token/session guard to ignore late callbacks.
