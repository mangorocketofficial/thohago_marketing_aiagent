# Step S2 Development Plan (Desktop Session Selector)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S2
- Status: Draft for implementation

## 1) Objective

Deliver a desktop session-selection UX foundation that lets users explicitly choose a session across mini chat surfaces, without auto-switching on page navigation.

S2 targets UX/state wiring only. It prepares S3 session-scoped data migration, but does not perform it.

## 2) S2 Scope

In scope:

1. Add mini-chat session selector bar (current session, recent 5, review-all entry, new session).
2. Introduce global `selectedSessionId` state shared by all mini chat entry points and Agent Chat context state.
3. Connect desktop runtime to S1 APIs:
   - list sessions
   - create session
   - get recommended session
4. Add recommendation UX ("Switch to recommended") without automatic switching.

Out of scope:

1. Session-scoped message query/subscription migration (`chat_messages.session_id` filtering) -> S3.
2. Lock/queue migration (`org` -> `session`) -> later phase.
3. Full Agent Chat session-hub redesign -> S4.

## 3) Product Rules (Must Hold)

1. No automatic session switch on page change.
2. No automatic new session creation from page navigation.
3. Session switch and new session are explicit user actions only.
4. Selected session is shared globally in desktop UI state.
5. Recommended session is advisory only.

## 4) Architecture Plan

### 4.1 State model

Introduce in chat-layer state:

1. `selectedSessionId: string | null`
2. `selectedSession: OrchestratorSession | null`
3. `recentSessions: OrchestratorSession[]` (top 5 for selector)
4. `recommendedSession: OrchestratorSession | null`
5. `isSessionLoading / isSessionMutating / sessionNotice`

Integration strategy:

1. Keep current `activeSession` compatibility path in `App.tsx` for existing runtime summary and fallback.
2. Create a dedicated `SessionSelectorContext` (mandatory in S2) for selected-session state, loaders, and selector actions.
3. Keep `ChatContext` focused on existing chat/runtime concerns and consume `SessionSelectorContext` via a narrow interface.
4. Ensure mini widget and Agent Chat consume the same selected-session value from one provider.

### 4.2 Persistence and precedence rules

Persistence policy:

1. Persist `selectedSessionId` per org key: `selectedSessionIdByOrg[orgId]`.
2. Restore persisted selection on app restart when org matches.
3. On org switch, load only that org's persisted selection; never carry previous org selection.

Code-level precedence between `activeSession` and `selectedSession`:

1. `selectedSession` is the UI source of truth after bootstrap completes.
2. `activeSession` remains compatibility/fallback input only and must not overwrite an already valid user-selected session.
3. If `selectedSession` becomes invalid (deleted/forbidden/archived visibility change), clear selection and re-run bootstrap order.

### 4.3 Fallback behavior

Selection bootstrap order:

1. Existing `selectedSessionId` (if valid in current org)
2. current active-session API result (`/sessions/active`)
3. recommended session for current workspace
4. first recent session
5. `null` with actionable notice

## 5) API Usage in S2

Consume S1 APIs as-is:

1. `GET /orgs/:orgId/sessions?limit=5&archived=false` for recent list.
2. `GET /orgs/:orgId/sessions` with cursor for "Review all tasks".
3. `POST /orgs/:orgId/sessions` for explicit "New session".
4. `GET /orgs/:orgId/sessions/recommended?workspace_type=&scope_id=` for advisory switching.
5. Keep `GET /orgs/:orgId/sessions/active` only for bootstrap compatibility.

Contract handling:

1. Honor `next_cursor` for paginated list expansion.
2. Handle `reused=true` response from create API and switch to returned session.
3. Keep API errors user-visible as non-blocking notices.
4. Apply race protection for switch/create/recommendation fetch:
   - maintain per-action request token and commit only the latest response (`last-write-wins`)
   - ignore stale responses that return after a newer request has started

## 6) Workspace Mapping Strategy (S2)

Because S2 does not yet have full scoped data routing, use deterministic mapping with safe fallback:

1. `dashboard`, `brand-review`, `analytics`, `email-automation`, `settings` -> `general:default`
2. `campaign-plan`:
   - `workspace_type=campaign_plan`
   - `scope_id` resolution order:
     - route/page context `campaignId` when available
     - `selectedSession.state.campaign_id` only when selected session workspace is `campaign_plan`
     - `default`
3. `content-create`:
   - `workspace_type=content_create`
   - `scope_id` resolution order:
     - route/page context `contentId` when available
     - `selectedSession.state.content_id` only when selected session workspace is `content_create`
     - `default`
4. `agent-chat`:
   - keep current selected session workspace; if none, `general:default`

This mapping is intentionally conservative until S3/S4 introduce stronger session-context ownership.
Recommendation API calls in S2 must use this mapping and must not derive scope from `activeSession`.

## 7) UI Plan

### 7.1 Mini Chat Session Bar

Placement:

1. At the top of `AgentChatWidget`.

Elements:

1. Current session chip:
   - title (fallback to workspace label)
   - workspace badge
   - status badge (`running/paused/done/failed`)
2. Recent sessions dropdown (up to 5)
3. `Review all tasks` button (opens modal in S2)
4. `New session` button
5. Contextual recommendation actions:
   - `Continue current`
   - `Switch to recommended` (shown only when recommended differs from selected)
6. Recommendation advisory noise limits:
   - debounce recommendation fetch on page-change driven checks (300-500ms)
   - suppress repeated prompts for the same `(recommendedSessionId, workspaceKey)` until selected session or workspace context changes

### 7.2 Review-All Tasks View

Location:

1. Implement as a modal in S2.

Behavior:

1. Paginated session list with cursor loading.
2. Row metadata:
   - title/workspace/status/updated time
3. Row actions:
   - select session
   - optional archive action not included in S2

### 7.3 Agent Chat visibility (S2)

1. Do not redesign full Agent Chat yet.
2. Show compact selected-session context summary near input or notice region.
3. Keep existing timeline UI unchanged.

## 8) Desktop Runtime / IPC Changes

`apps/desktop/electron/main.mjs`:

1. Add `chat:list-sessions` handler -> proxies `GET /orgs/:orgId/sessions`.
2. Add `chat:create-session` handler -> proxies `POST /orgs/:orgId/sessions`.
3. Add `chat:get-recommended-session` handler -> proxies recommended endpoint.
4. Keep existing `chat:get-active-session` unchanged.

`apps/desktop/src/global.d.ts`:

1. Add typed methods and payload/result contracts for the 3 new handlers.

## 9) Frontend File-Level Plan

1. `apps/desktop/src/context/SessionSelectorContext.tsx` (new)
   - own selected-session state, loaders, mutation actions, and persistence wiring
   - implement bootstrap, precedence, race guard, and recommendation advisory state
2. `apps/desktop/src/context/ChatContext.tsx`
   - consume selected-session via narrow interface only where needed
3. `apps/desktop/src/components/AgentChatWidget.tsx`
   - add session selector bar UI and all actions
4. `apps/desktop/src/pages/AgentChat.tsx`
   - show selected-session summary (non-invasive)
5. `apps/desktop/src/App.tsx`
   - keep existing active session refresh
   - pass required context for selector bootstrap and workspace recommendation
6. `apps/desktop/src/i18n/locales/en.json`
7. `apps/desktop/src/i18n/locales/ko.json`
   - add text keys for session selector labels, actions, errors
   - use fixed prefix: `chat.sessionSelector.*`
   - examples: `chat.sessionSelector.reviewAll`, `chat.sessionSelector.newSession`, `chat.sessionSelector.switchRecommended`, `chat.sessionSelector.error.loadFailed`

## 10) Behavioral Guardrails

1. Page navigation must never mutate `selectedSessionId` directly.
2. Recommendation check can run on page change but only updates advisory UI state.
3. During `isSessionMutating=true`, disable `sendMessage` and action-card dispatch buttons (`approve/revise/reject`) to prevent cross-session writes.
4. Do not queue optimistic cross-session sends in S2.
5. `sendMessage` / action-card dispatch behavior remains otherwise unchanged in S2 unless explicitly enabled by a narrow feature flag.
6. Any cross-session action mismatch should surface warning notice rather than silently rerouting.
7. Session switch/new-session actions must use `last-write-wins` semantics at UI state commit.

## 11) Implementation Sequence

1. Freeze shared contracts first (`global.d.ts`, selector context types, API payload/result shapes).
2. In parallel:
   - add IPC contracts/runtime handlers
   - implement `SessionSelectorContext` state/actions/bootstrap/race guard
3. Wire mini chat selector bar UI for recent/recommended/new-session actions.
4. Add Review-All modal with paginated list.
5. Add Agent Chat selected-session summary.
6. Add i18n keys under `chat.sessionSelector.*` and final UX copy pass.
7. Execute validation checklist.

## 12) Validation Plan

Automated:

1. `pnpm type-check`

Manual QA:

1. Selector renders on mini chat and shows current selection.
2. Switching recent session updates global selected session.
3. "New session" creates or reuses workspace session and selects it.
4. "Switch to recommended" works only on explicit click.
5. Page navigation does not auto-switch selected session.
6. Review-all list paginates correctly.
7. Existing chat send/action-card flows still work without regression.
8. `selectedSessionId` persists per org across app restart and restores correctly.
9. Org switch loads the target org selection only (no cross-org leakage).
10. Logout/login re-bootstrap selects a valid session using defined fallback order.
11. While session switch/create is mutating, send/action controls are disabled.
12. Rapid repeated switch/create clicks resolve to latest request result only.
13. Repeated page changes do not spam identical recommendation prompts.
14. Archived session or permission change on selected session triggers graceful invalidation and re-bootstrap notice.

## 13) Acceptance Criteria (S2)

1. User can view current selected session in mini chat.
2. User can switch among recent 5 sessions.
3. User can open full session list and select any session.
4. User can explicitly create a new session.
5. User can explicitly switch to recommended session when available.
6. Selected session is shared across mini chat and Agent Chat context state.
7. No automatic session switch occurs from navigation.
8. Existing chat flows remain stable after S2 rollout.

## 14) Rollback Plan

1. Keep existing `activeSession` path intact as fallback.
2. Feature-flag session selector rendering if needed.
3. If selector causes regressions, disable new IPC usage and retain previous mini chat behavior.
