# Phase Session S3 Completion Report

- Phase: Session-S3
- Title: Session-Scoped Chat Data Cutover
- Status: Done
- Completed On: 2026-03-04

## 1) Goals and Scope

- Goal:
  - Cut over desktop chat timeline from org-scoped reads/subscriptions to selected-session scoped behavior.
- In Scope:
  - Message query path switched to selected session (`org_id + session_id`).
  - Message realtime rebinding implemented for session switch with race guards.
  - Legacy `session_id IS NULL` rows hidden from normal timeline with explicit read-only fallback entrypoint.
  - Dashboard/Settings `activeSession` kept as compatibility-only display.
  - Dev bootstrap hardening for API base URL/port mismatch fail-fast.
  - S3 smoke coverage added for session isolation and switch-time leakage guard behavior.
- Out of Scope:
  - Lock scope migration (`org` -> `session`).
  - Queue model migration to per-session execution.
  - Full Agent Chat session-hub redesign (S4).
  - Hard migration to `chat_messages.session_id NOT NULL`.

## 2) Risks Addressed

1. Cross-session timeline mixing:
   - Message query switched to selected-session filter.
   - Message realtime path now session-aware with callback token/session guards.

2. Session switch residue/race:
   - Switch order enforced as `clear -> unsubscribe -> subscribe -> snapshot`.
   - Late callbacks from previous selection are ignored.

3. Legacy null-row confusion:
   - Legacy messages removed from normal timeline.
   - Read-only `Legacy messages` entrypoint added in Agent Chat.

4. Dev environment misconfiguration:
   - Added strict fail-fast when `ORCHESTRATOR_API_BASE` port mismatches `API_PORT`.

5. Compatibility rollback safety:
   - Runtime timeline scope contract introduced (`session|org`) for operational rollback.

## 3) Implemented Deliverables

1. Desktop runtime config and fail-fast:
   - `apps/desktop/electron/run-dev-electron.mjs`
   - `apps/desktop/electron/main.mjs`
   - `apps/desktop/src/global.d.ts`
   - Added timeline scope contract and API port/base mismatch hard failure.

2. Session-scoped chat data cutover:
   - `apps/desktop/src/context/ChatContext.tsx`
   - Message read/subscription cutover by selected session.
   - Session-switch clear/rebind order + stale callback guard.
   - Non-message subscriptions (`campaigns`, `contents`) kept org-scoped.

3. Legacy fallback UX:
   - `apps/desktop/src/pages/AgentChat.tsx`
   - Added read-only `Legacy messages` toggle and disabled writes in legacy mode.

4. Compatibility labeling:
   - `apps/desktop/src/pages/Dashboard.tsx`
   - `apps/desktop/src/pages/Settings.tsx`
   - `apps/desktop/src/styles.css`
   - Runtime `activeSession` fields explicitly labeled compatibility-only.

5. i18n updates:
   - `apps/desktop/src/i18n/locales/en.json`
   - `apps/desktop/src/i18n/locales/ko.json`
   - Added legacy-view and compatibility-only copy.

6. Validation harness:
   - `scripts/smoke-session-s3.mjs` (new)
   - `package.json` (`smoke:s3`)
   - Added session-isolation checks and selected-session gate validation path.

## 4) Validation Executed

- `pnpm type-check` -> PASS
- `pnpm smoke:s3` -> PASS
  - Session A/B timeline isolation -> PASS
  - Legacy null-row exclusion from normal session queries -> PASS
  - Selected-session gate leakage protection -> PASS
  - Note: local realtime delivery was unavailable in test environment; deterministic fallback gate validation executed and passed.

## 5) Acceptance Check

1. Timeline reads are selected-session scoped -> Met.
2. Session switch rebinding clears stale timeline and guards late callbacks -> Met.
3. Cross-session bleed removed in normal timeline paths -> Met.
4. Legacy rows are hidden from normal timeline with explicit read-only fallback -> Met.
5. Dashboard/Settings compatibility path remains visible and clearly labeled -> Met.
6. Dev bootstrap detects API port/base mismatch early -> Met.
7. Rollback-capable timeline scope contract (`session|org`) is in place -> Met.

## 6) Final Result

- Session S3 cutover is complete.
- Desktop chat timeline behavior is now session-scoped by default, with guarded switch semantics and explicit legacy read-only fallback.
