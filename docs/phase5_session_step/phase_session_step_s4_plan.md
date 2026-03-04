# Step S4 Development Plan (Agent Chat Session Hub Consolidation)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S4
- Status: Draft for implementation

## 1) Objective

Finalize the session redesign by turning Agent Chat into a clear session hub while preserving the S1-S3 safety model.

S4 focuses on:

1. Making session context and session switching explicit inside Agent Chat itself.
2. Reducing duplicated session-management UX between mini chat and Agent Chat.
3. Removing temporary compatibility-only `activeSession` display surfaces introduced during S2/S3 transition.

## 2) Current State Snapshot (As of 2026-03-04)

Completed foundation:

1. S1: workspace-aware multi-session DB/API foundation.
2. S2: selected-session global state + mini-chat selector/review-all/new/recommended UX.
3. S3: session-scoped timeline read/realtime cutover + legacy read-only fallback.

Remaining S4 gaps:

1. Agent Chat still behaves mostly as a timeline page with limited session-hub UX.
2. Session list browsing is still centered in mini-chat widget modal rather than Agent Chat.
3. Dashboard/Settings still show `activeSession` runtime fields (currently labeled compatibility-only).

## 3) S4 Scope

In scope:

1. Restructure Agent Chat page into a session hub + timeline layout.
2. Add a first-class in-page session panel in Agent Chat:
   - recent sessions
   - full paginated session list
   - explicit select/new actions
   - recommended-session switch actions
3. Keep and integrate `Legacy messages` as an explicit read-only entrypoint within Agent Chat session UX.
4. Remove `activeSession` compatibility-only display from Dashboard and Settings UI.
5. Keep selected-session as the single source of truth for timeline/action dispatch.
6. Add S4 validation coverage for Agent Chat hub interactions and session isolation continuity.

Out of scope:

1. Lock scope migration (`org` -> `session`).
2. Queue execution model migration to per-session workers.
3. Folder-as-project routing implementation (S5).
4. Hard DB enforcement of `chat_messages.session_id NOT NULL`.
5. Multi-user collaboration policy redesign.

## 4) Product Rules (Must Hold)

1. `selectedSessionId` remains the only authority for timeline and action dispatch.
2. Page navigation must not auto-switch sessions.
3. Session switches and new session creation remain explicit user actions only.
4. `Legacy messages` remains read-only and cannot trigger send/action dispatch.
5. Removing `activeSession` visual fields must not change chat runtime correctness.

## 5) UX Plan

### 5.1 Agent Chat layout

Split Agent Chat into two functional areas:

1. Session hub panel:
   - current selected session summary
   - recent sessions quick list
   - full session list (paginated)
   - explicit actions (`Select`, `New Session`, `Switch to recommended`)
2. Timeline panel:
   - session-scoped message timeline
   - action-card controls
   - send input area

Layout decision for S4:

1. Desktop/tablet: fixed two-column layout (`left session hub sidebar + right timeline main`).
2. Mobile/narrow width: timeline-first with a toggleable session drawer that renders the same hub content.
3. Mini chat remains separate and lightweight; full session management stays in Agent Chat.

### 5.2 Session context clarity

Always show selected-session metadata near the timeline header:

1. title (fallback workspace label)
2. workspace label (`workspace_type:scope_id`)
3. status
4. updated-at timestamp (when available)

### 5.3 Legacy messaging UX

1. Keep `Legacy messages` as a clearly labeled entry in Agent Chat.
2. Legacy view stays read-only and visually separated from normal session timeline.
3. Switching back from legacy returns to selected-session timeline without mutating selection.

### 5.4 Mini chat widget posture in S4

1. Keep mini chat lightweight for quick interactions.
2. Add/keep a clear path to open full Agent Chat hub for complete session management.
3. Avoid re-implementing full review/list complexity separately inside the widget.

## 6) Architecture Plan

### 6.1 Ownership boundaries

1. `SessionSelectorContext` remains owner of:
   - selected session identity
   - session list/recommendation loading
   - session mutations (create/select/invalidate)
2. `ChatContext` remains owner of:
   - timeline query/subscription
   - chat send/action dispatch safeguards
   - legacy message read path
3. Agent Chat page composes both contexts into a single session-hub UX.

### 6.2 Compatibility cleanup policy

1. Remove `activeSession` display from Dashboard/Settings in S4.
2. Internal compatibility calls may remain temporarily where still required by runtime behavior.
3. Any remaining compatibility dependency must be invisible at user-facing UI level.

### 6.3 Race and stale-state safety

1. Keep last-write-wins selection behavior from S2.
2. Keep stale callback/token guards from S3.
3. Ensure hub interactions do not bypass existing mutation guards (`isSessionMutating`, `isActionPending`).

### 6.4 Shared session-list rendering policy

1. Avoid duplicated session-list rendering logic between Agent Chat and mini chat review-all surface.
2. Extract shared presentational components (for example `SessionList` / `SessionListItem`) and reuse across both surfaces.
3. Keep data/state ownership in contexts; shared list components remain view-only.

## 7) API / IPC Posture in S4

Base assumption:

1. Reuse existing S1/S2 APIs and IPC contracts (`list/create/recommended`) for S4 UI.

Optional extension only if needed during implementation:

1. Add dedicated session metadata mutation endpoints (for example title/archive) only if required by approved S4 UX.
2. Do not couple S4 completion to non-essential API expansion.

## 8) File-Level Plan

1. `apps/desktop/src/pages/AgentChat.tsx`
   - implement session-hub layout (panel + timeline)
   - integrate full session list/recent/recommended/new-session actions
   - keep legacy read-only mode integrated
2. `apps/desktop/src/components/AgentChatWidget.tsx`
   - keep quick selector/send behavior
   - ensure clear handoff/open path to Agent Chat hub
3. `apps/desktop/src/components/session/SessionList.tsx` (new, shared)
   - shared session list rendering for Agent Chat hub and mini chat review-all fallback
4. `apps/desktop/src/context/SessionSelectorContext.tsx`
   - expose any additional read-only session view state needed by Agent Chat panel
   - preserve existing bootstrap/persistence/race logic
5. `apps/desktop/src/context/NavigationContext.tsx`
6. `apps/desktop/src/types/navigation.ts`
   - extend handoff options only if needed for deep-link/open-hub behavior
7. `apps/desktop/src/pages/Dashboard.tsx`
   - remove `activeSession` compatibility-only runtime field display
8. `apps/desktop/src/pages/Settings.tsx`
   - remove `activeSession` compatibility-only runtime field display
9. `apps/desktop/src/hooks/useRuntime.ts`
   - remove runtime summary fields only after dependency grep confirms no runtime-critical usage
10. `apps/desktop/src/i18n/locales/en.json`
11. `apps/desktop/src/i18n/locales/ko.json`
   - add/update S4 session-hub labels and notices
12. `apps/desktop/src/styles.css`
   - add layout/styles for Agent Chat hub and legacy separation

## 9) Implementation Sequence

1. Finalize Agent Chat hub layout contract (state mapping and interaction flow).
2. Refactor Agent Chat page to consume existing `SessionSelectorContext` list/review/recommend actions directly.
3. Simplify mini-chat widget posture and add explicit open-hub path.
4. Run dependency grep for `activeSession` and runtime summary fields; classify UI-only vs runtime-critical usages.
5. Remove Dashboard/Settings compatibility-only `activeSession` display fields.
6. Update runtime summary typing/usages only for confirmed UI-only fields.
7. Apply i18n and style updates.
8. Run S4 validation checklist.

## 10) Validation Plan

Automated:

1. `pnpm type-check`
2. Existing session smoke coverage:
   - `pnpm smoke:s3` (session isolation baseline)
3. S4 smoke script (new): Agent Chat session-hub flow
   - select session A/B from Agent Chat hub
   - verify timeline switches cleanly and stays isolated
   - verify legacy view is read-only and cannot dispatch sends/actions
   - verify recommended switch requires explicit action

Manual QA:

1. Agent Chat clearly shows current session context at all times.
2. Full session list selection works inside Agent Chat without relying on widget modal.
3. New session creation from Agent Chat works and selects created/reused session.
4. Legacy messages remain accessible and read-only.
5. Session switch retains S3 behavior (`clear -> unsubscribe -> subscribe -> snapshot -> isolated timeline`).
6. Mini chat still supports quick select/send and can hand off to Agent Chat hub.
7. Dashboard/Settings no longer display compatibility-only `activeSession` fields.
8. No regression in action-card dispatch guards across session boundaries.
9. Agent Chat hub and mini chat review-all surface show consistent session list ordering and labels.

## 11) Acceptance Criteria (S4)

1. Agent Chat functions as a session hub, not only a plain timeline view.
2. Users can manage session selection from Agent Chat directly (recent/full/recommended/new).
3. Selected session remains globally consistent across Agent Chat and mini chat.
4. Legacy messages remain explicitly accessible and read-only.
5. Dashboard/Settings no longer expose compatibility-only `activeSession` runtime fields.
6. S3 session isolation and mutation safety guarantees remain intact.
7. System is ready for S5 folder-based session routing integration.

## 11.1) S5 Readiness Gate Conditions

1. Workspace key contract safely represents folder scope (`workspace_type=folder` with stable folder-derived `scope_id`).
2. Session create/list/recommended APIs handle folder scope without org-only fallback assumptions.
3. Selected-session persistence and restore work across app restart for folder-scoped sessions.
4. Explicit-switch-only rule remains intact in both Agent Chat and mini chat under folder-scoped workspaces.

## 12) Rollback Plan

1. Keep SessionSelector core state contract unchanged during S4 rollout.
2. If S4 Agent Chat hub UI regresses, temporarily revert Agent Chat page to S3 layout while keeping S3 data isolation.
3. Keep mini chat selector path operational as fallback for session switching.
4. Do not rollback schema/data changes; rollback is UI composition level only.
