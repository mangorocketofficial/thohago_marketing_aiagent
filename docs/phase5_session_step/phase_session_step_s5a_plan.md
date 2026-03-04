# Step S5a Development Plan (Workspace Shell + Queue/Chat Policy Separation)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S5a
- Status: Draft for implementation

## 1) Context

Session S1–S4 established a multi-session foundation, but the current UX still has fundamental problems:

1. **Action cards block chat**: Pending approval items prevent all normal conversation.
2. **Session identity is unclear**: Users cannot easily tell which session they are operating in.
3. **Per-page mini-chat fragmentation**: The board-per-page layout misleads users into thinking chat is segmented by page.
4. **Workflow ambiguity**: Campaign pipeline (Flow A) and on-demand content (Flow B) paths are not distinguished in the UI.

**Product principle**: Chat AI Agent = the user's sole work interface. UI = situational awareness and decision-support tooling.

**Objective**: Introduce a Workspace page with a 3-panel composition — Inbox (work queue) + Chat + Session Rail — and remove action cards from the chat timeline so they appear only in the Inbox.

## 2) Scope

In scope:

1. Workspace 3-panel shell (Inbox | Chat | Session Rail).
2. Navigation restructuring: remove `campaign-plan`, `content-create`, `agent-chat`; add `workspace`.
3. Action card removal from chat timeline (client-side filter).
4. Chat input unblocking from pending approval state.
5. `dispatchCardAction` session-match guard removal for Inbox independence.
6. Old page deletion (`AgentChat.tsx`, `CampaignPlan.tsx`, `ContentCreate.tsx`).

Out of scope:

1. Backend chat-projection change (action_card → system notification) — deferred to S5b.
2. `work_items` / `artifacts` data model extension — deferred to S5b.
3. Canvas artifact preview/editor — deferred to S5c.
4. Mobile/narrow layout.
5. Lock scope migration (`org` → `session`).

## 3) Layout Design

```
┌──────────┬─────────────────┬──────────┐
│  Inbox   │     Chat        │ Session  │
│  (A)     │     (B)         │  Rail    │
│  320px   │     flex        │  (C)     │
│          │                 │  280px   │
│ workflow │ Session chat    │ Session  │
│ items    │ timeline        │ info     │
│ list     │ (action_card    │ Switch   │
│          │  filtered out)  │ New      │
│ Approve/ │                 │ Recom-   │
│ Reject   │                 │ mended   │
└──────────┴─────────────────┴──────────┘
```

- **Panel A (Inbox)**: Read-only work queue. Shows pending workflow items. User can view, approve, request revision, or reject. No creation/editing/deletion — those happen via Chat.
- **Panel B (Chat)**: Session-scoped chat timeline. Action card messages filtered out. Chat input is never blocked by pending approvals.
- **Panel C (Session Rail)**: Session identity, switch, new session, recommended session, recent list.

## 4) Implementation Steps

### Step 1: Navigation Type Changes

**File**: `apps/desktop/src/types/navigation.ts`

- Remove `"campaign-plan"`, `"content-create"`, `"agent-chat"` from `PageId` union; add `"workspace"`.
- Update `FULL_WIDTH_PAGES` to `["workspace", "settings"]`.
- Update `NAV_ITEMS`:
  - primary: `workspace`, `dashboard`, `brand-review`, `analytics`, `email-automation`
  - secondary: `settings`
- Rename `AgentChatHandoff` → `WorkspaceHandoff` (keep `focusWorkflowItemId` only).
- Update `NavigateOptions` and `NavigationState` to use `WorkspaceHandoff`.

### Step 2: NavigationContext Update

**File**: `apps/desktop/src/context/NavigationContext.tsx`

- Change `INITIAL_NAVIGATION_STATE.activePage` to `"workspace"`.
- Change handoff condition from `pageId === "agent-chat"` to `pageId === "workspace"`.
- Rename `agentChatHandoff` → `workspaceHandoff` and `clearAgentChatHandoff` → `clearWorkspaceHandoff`.

### Step 3: SessionSelectorContext Update

**File**: `apps/desktop/src/context/SessionSelectorContext.tsx`

- In `resolveWorkspaceContext`, remove `"campaign-plan"`, `"content-create"`, `"agent-chat"` cases.
- Add `"workspace"` case (same logic as the previous `"agent-chat"` case).

### Step 4: MainLayout Update

**File**: `apps/desktop/src/layouts/MainLayout.tsx`

- Remove `campaignPlanPage`, `contentCreatePage`, `agentChatPage` from `MainLayoutProps`.
- Add `workspacePage` to `MainLayoutProps`.
- Update `resolvePageNode` switch: remove old cases, add `case "workspace"`.

### Step 5: App.tsx Update

**File**: `apps/desktop/src/App.tsx`

- Remove imports: `CampaignPlanPage`, `ContentCreatePage`, `AgentChatPage`.
- Add import: `WorkspacePage`.
- Replace MainLayout props: remove old page props, add `workspacePage={<WorkspacePage formatDateTime={formatDateTime} />}`.

### Step 6: Workspace Page Shell

**File**: `apps/desktop/src/pages/Workspace.tsx` (NEW)

- Create 3-panel A-B-C grid layout.
- Import and compose `InboxPanel`, `WorkspaceChatPanel`, `SessionRailPanel`.
- Accept `formatDateTime` prop.

### Step 7: WorkspaceChatPanel

**File**: `apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx` (NEW)

- Extract chat timeline and input logic from `AgentChat.tsx`.
- Filter out action_card messages: `messages.filter(m => m.message_type !== "action_card")`.
- Chat input disabled condition: `isSessionMutating || !selectedSessionId` only (**not** `isActionPending`).
- Set `uiContext.source` to `"workspace-chat"`.
- Remove all action card local state (`collapsedCards`, `reasonByCard`, `editByCard`, etc.).
- Keep legacy message toggle.

### Step 8: SessionRailPanel

**File**: `apps/desktop/src/components/workspace/SessionRailPanel.tsx` (NEW)

- Extract session hub sidebar logic from `AgentChat.tsx`.
- Current session summary, workspace context label.
- New session / Refresh buttons.
- Recommended session banner.
- Recent sessions list (reuse `SessionList` component from `apps/desktop/src/components/session/SessionList.tsx`).
- Review-all sessions with load-more pagination.

### Step 9: ChatContext Policy Change

**File**: `apps/desktop/src/context/ChatContext.tsx`

- Change `dispatchCardAction` signature:
  - Before: `Omit<ChatActionCardDispatchInput, "campaignId" | "contentId">`
  - After: `ChatActionCardDispatchInput` (accept `campaignId`/`contentId` directly)
- Remove `selectedSessionId !== sessionId` guard (Inbox dispatches independently of selected chat session).
- Keep `selectedSession.state.campaign_id/content_id` as fallback, but prefer directly supplied values.
- Add `"workspace-chat"` to `ChatUiContext.source` type.

### Step 10: InboxPanel

**File**: `apps/desktop/src/components/workspace/InboxPanel.tsx` (NEW)

- Read from `ChatContext`: `draftCampaigns`, `pendingContents`, `campaignWorkflowHints`, `pendingContentWorkflowHints`, `isActionPending`, `dispatchCardAction`.
- Render pending workflow items (status `"proposed"`) with approve/revision/reject buttons.
- Extract action card rendering helpers from `AgentChat.tsx` (detail display, action buttons).
- Pass `campaignId`/`contentId` from workflow hint data directly to `dispatchCardAction`.
- Use `isActionPending` to disable Inbox action buttons only (does **not** block Chat input).

### Step 11: AgentChatWidget Update

**File**: `apps/desktop/src/components/AgentChatWidget.tsx`

- Change "Open Hub" navigation target from `"agent-chat"` to `"workspace"`.
- Add action_card message filter to recent messages display.
- Keep `ChatUiContext.source` as `"context-panel-widget"`.

### Step 12: ContextPanel Update

**File**: `apps/desktop/src/components/ContextPanel.tsx`

- Remove/update i18n keys for `campaign-plan`, `content-create`, `agent-chat` page context titles.

### Step 13: Delete Old Pages

- `apps/desktop/src/pages/AgentChat.tsx` → Delete (logic moved to workspace sub-components).
- `apps/desktop/src/pages/CampaignPlan.tsx` → Delete.
- `apps/desktop/src/pages/ContentCreate.tsx` → Delete.

### Step 14: i18n Updates

**Files**: `apps/desktop/src/i18n/locales/en.json`, `apps/desktop/src/i18n/locales/ko.json`

- Add `ui.nav.workspace`: `"Workspace"` / `"워크스페이스"`.
- Add `ui.pages.workspace.*`: `eyebrow`, `inboxTitle`, `inboxEmpty`, `inboxDescription`, `chatTitle`, `sessionRailTitle`.
- Remove `campaign-plan`, `content-create`, `agent-chat` navigation keys.

### Step 15: CSS Styles

**File**: `apps/desktop/src/styles.css`

- `.ui-workspace-shell`: 3-column grid (`320px / 1fr / 280px`).
- `.ui-workspace-inbox`: left panel styles (border, background, overflow, padding).
- `.ui-workspace-chat`: center panel styles (flex column, overflow).
- `.ui-workspace-session-rail`: right panel styles (border, background, overflow, padding).
- Inbox card styles (adapt from existing `.chat-action-card` styles).

## 5) Implementation Sequence

1. **Navigation types + Context** (Steps 1, 2, 3) — breaks compilation, fix forward.
2. **MainLayout + App.tsx** (Steps 4, 5) — add workspace slot, remove old page slots.
3. **Workspace shell** (Step 6) — empty 3-panel layout.
4. **WorkspaceChatPanel** (Step 7) — extract chat from AgentChat, filter action_cards.
5. **SessionRailPanel** (Step 8) — extract session hub from AgentChat.
6. **ChatContext policy** (Step 9) — dispatchCardAction signature change, session-match guard removal.
7. **InboxPanel** (Step 10) — extract action card rendering from AgentChat, build Inbox UI.
8. **AgentChatWidget** (Step 11) — navigation target change, action_card filter.
9. **ContextPanel + old page deletion** (Steps 12, 13).
10. **i18n + CSS** (Steps 14, 15).

## 6) Backend Changes (Minimal in S5a)

- `apps/api/src/orchestrator/chat-projection.ts`: **No changes in S5a**. Action cards continue to be inserted into `chat_messages`.
- Frontend filters out `message_type !== "action_card"` from timeline display.
- Backend projection migration to system notifications is deferred to S5b.

## 7) Key Design Decisions

1. **dispatchCardAction session independence**: When Inbox dispatches an action, it operates independently of the currently selected chat session. `campaignId`/`contentId` are supplied directly from workflow hint data, not derived from `selectedSession.state`.

2. **Existing action_card messages**: Already-stored action_card messages in the database are hidden via client-side filter. No data deletion or migration.

3. **Dashboard page**: Unchanged. Existing dashboard remains as-is.

4. **Backend lock**: Org-level lock preserved (no change in S5a).

5. **Chat never blocked by approvals**: Chat input is disabled only by `isSessionMutating || !selectedSessionId`. `isActionPending` affects Inbox buttons only.

## 8) Critical Files Summary

| File | Action | Description |
|---|---|---|
| `apps/desktop/src/types/navigation.ts` | Modify | PageId, NAV_ITEMS, handoff type |
| `apps/desktop/src/context/NavigationContext.tsx` | Modify | Initial page, handoff rename |
| `apps/desktop/src/context/SessionSelectorContext.tsx` | Modify | Workspace context resolution |
| `apps/desktop/src/context/ChatContext.tsx` | Modify | dispatchCardAction policy change |
| `apps/desktop/src/layouts/MainLayout.tsx` | Modify | Page slot restructure |
| `apps/desktop/src/App.tsx` | Modify | Provider/page wiring |
| `apps/desktop/src/pages/Workspace.tsx` | **New** | 3-panel workspace shell |
| `apps/desktop/src/components/workspace/InboxPanel.tsx` | **New** | Approval inbox panel |
| `apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx` | **New** | Chat panel (no action cards) |
| `apps/desktop/src/components/workspace/SessionRailPanel.tsx` | **New** | Session management rail |
| `apps/desktop/src/components/AgentChatWidget.tsx` | Modify | Navigate target, card filter |
| `apps/desktop/src/components/ContextPanel.tsx` | Modify | i18n key cleanup |
| `apps/desktop/src/pages/AgentChat.tsx` | **Delete** | Logic moved to workspace |
| `apps/desktop/src/pages/CampaignPlan.tsx` | **Delete** | Removed from navigation |
| `apps/desktop/src/pages/ContentCreate.tsx` | **Delete** | Removed from navigation |
| `apps/desktop/src/i18n/locales/en.json` | Modify | Workspace keys |
| `apps/desktop/src/i18n/locales/ko.json` | Modify | Workspace keys |
| `apps/desktop/src/styles.css` | Modify | Workspace layout styles |

## 9) Validation Plan

Automated:

1. `pnpm type-check` → PASS.
2. `pnpm smoke:s3` (when environment is available).

Manual QA:

1. Workspace page renders with 3-panel layout.
2. Inbox displays workflow items (`campaigns` draft + `contents` pending_approval).
3. Chat timeline does not show action_card messages.
4. Session Rail shows session selection, switch, and new session functionality.
5. Inbox approve/reject dispatches correctly regardless of selected chat session.
6. Chat input remains usable while approvals are pending.
7. Workspace is the default landing page.
8. `Campaign Plan`, `Content Create`, `Agent Chat` navigation items are removed.
9. ContextPanel mini-chat on other pages (Dashboard, Brand Review, etc.) works normally.

## 10) Acceptance Criteria

1. Workspace is the single operational surface for queue actions and chat.
2. Session identity is continuously visible in the Session Rail.
3. Pending approvals do not create "chat blocked" confusion.
4. Action cards appear only in Inbox, not in the chat timeline.
5. Inbox approve/reject works independently of the selected chat session.
6. Legacy behavior (existing data, legacy messages) remains safe and read-only.
7. Other pages (Dashboard, Brand Review, Analytics, Settings) are unaffected.
8. System is prepared for S5b (data model extension) and S5c (Canvas MVP).
