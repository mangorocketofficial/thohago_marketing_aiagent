# Step S5c Development Plan (Canvas MVP Skeleton)

- Date: 2026-03-04
- Scope: Phase Session Redesign - Step S5c
- Status: Draft for implementation
- Depends on: S5b completion

## 1) Context

S5a delivers the Workspace shell (Inbox + Chat + Session Rail) and S5b adds session provenance linking to work items. The center panel (B) currently contains only the Chat. The Canvas area — where users preview and interact with artifacts (campaign plans, content drafts) — does not yet exist.

**Objective**: Add a Canvas skeleton to the Workspace center panel that renders artifact previews when an Inbox item is selected. The Canvas is a read-only preview surface in S5c; interactive editing will be added incrementally as individual content generation features are built.

**Principle**: Canvas is a decision-support tool. Users view artifacts here to understand what the AI produced, then approve/revise via Inbox or instruct changes via Chat.

## 2) Scope

In scope:

1. Canvas panel added to Workspace center area (stacked above Chat).
2. Inbox item selection → Canvas preview rendering.
3. Campaign plan preview renderer (structured plan data display).
4. Content draft preview renderer (text body + metadata display).
5. Chat ↔ Canvas context linking (chat input carries artifact reference metadata).
6. Canvas/Chat split ratio (default 50/50, user-adjustable).

Out of scope:

1. Direct editing within Canvas (deferred to content generation feature phases).
2. Version history UI (deferred).
3. Image/video artifact rendering (deferred to media content phases).
4. Mobile/narrow layout.
5. Collaborative multi-user viewing.

## 3) Layout Change

### Before (S5a)

```
┌──────────┬─────────────────┬──────────┐
│  Inbox   │     Chat        │ Session  │
│  (A)     │     (B)         │  Rail    │
│          │     100%        │  (C)     │
└──────────┴─────────────────┴──────────┘
```

### After (S5c)

```
┌──────────┬─────────────────┬──────────┐
│  Inbox   │     Canvas      │ Session  │
│  (A)     │     (B-top)     │  Rail    │
│          │     50%         │  (C)     │
│          ├─────────────────┤          │
│          │     Chat        │          │
│          │     (B-bottom)  │          │
│          │     50%         │          │
└──────────┴─────────────────┴──────────┘
```

- Default split: 50% Canvas / 50% Chat (adjustable via drag handle).
- When no artifact is selected: Canvas shows empty state, Chat expands to fill.

## 4) Implementation Steps

### Step 1: Workspace Layout Update

**File**: `apps/desktop/src/pages/Workspace.tsx`

- Change center panel (B) from single Chat to vertically stacked Canvas + Chat.
- Add resizable split container with drag handle.
- Track `selectedInboxItemId` state to determine what to show in Canvas.
- When no item selected: hide Canvas, show Chat full-height.

### Step 2: Canvas Panel Component

**File**: `apps/desktop/src/components/workspace/CanvasPanel.tsx` (NEW)

- Accepts `selectedWorkflowItem` and associated `campaign` or `content` data.
- Empty state: "Select an item from the Inbox to preview" placeholder.
- Header: artifact title, type badge, status badge, session origin label.
- Body: delegates to type-specific preview renderer.

### Step 3: Campaign Plan Preview Renderer

**File**: `apps/desktop/src/components/workspace/previews/CampaignPlanPreview.tsx` (NEW)

- Renders `campaign.plan` structured data:
  - Objective
  - Channels list
  - Duration / Post count
  - Suggested schedule table (day, channel, type)
- Read-only display. Styled for scannability.

### Step 4: Content Draft Preview Renderer

**File**: `apps/desktop/src/components/workspace/previews/ContentDraftPreview.tsx` (NEW)

- Renders `content.body` as formatted text.
- Metadata sidebar or footer: channel, content_type, created_by, forbidden_check status.
- Read-only display.

### Step 5: Inbox → Canvas Selection Wiring

**File**: `apps/desktop/src/components/workspace/InboxPanel.tsx`

- On Inbox item click: set `selectedInboxItemId` in parent Workspace state.
- Highlight selected item in Inbox list.
- Pass corresponding `campaign` or `content` data to Canvas via Workspace state.

### Step 6: Chat → Canvas Context Linking

**File**: `apps/desktop/src/components/workspace/WorkspaceChatPanel.tsx`

- When Canvas has an active artifact, include artifact reference in `uiContext`:
  ```typescript
  uiContext: {
    source: "workspace-chat",
    pageId: "workspace",
    focusWorkflowItemId: selectedWorkflowItemId,
    focusCampaignId: selectedCampaignId,
    focusContentId: selectedContentId
  }
  ```
- Display a small context indicator above chat input: "Chatting about: [artifact title]".
- User can clear the artifact context link to return to general chat.

### Step 7: CSS Styles

**File**: `apps/desktop/src/styles.css`

- `.ui-workspace-center`: flex column container for Canvas + Chat.
- `.ui-workspace-canvas`: top portion with overflow-y auto.
- `.ui-workspace-canvas-empty`: empty state styling.
- `.ui-workspace-split-handle`: draggable resize handle between Canvas and Chat.
- `.ui-canvas-header`: artifact title bar.
- `.ui-canvas-body`: preview content area.
- Campaign plan preview table styles.
- Content draft preview text styles.

### Step 8: i18n Updates

**Files**: `apps/desktop/src/i18n/locales/en.json`, `ko.json`

- `ui.pages.workspace.canvasEmpty`: "Select an item from the Inbox to preview."
- `ui.pages.workspace.canvasTitle`: "Preview"
- `ui.pages.workspace.chattingAbout`: "Chatting about: {{title}}"
- `ui.pages.workspace.clearContext`: "Clear context"

## 5) Implementation Sequence

1. **Workspace layout update** (Step 1) — add split container, selectedInboxItemId state.
2. **CanvasPanel skeleton** (Step 2) — empty state + header.
3. **Preview renderers** (Steps 3, 4) — campaign plan + content draft.
4. **Inbox selection wiring** (Step 5) — click → Canvas update.
5. **Chat context linking** (Step 6) — artifact reference in uiContext.
6. **CSS + i18n** (Steps 7, 8).

## 6) Future Extension Points

S5c establishes the Canvas skeleton. The following will be added incrementally as content generation features are built:

1. **Direct editing**: Content body editing within Canvas (tied to specific content type features).
2. **Image/video preview**: Media artifact rendering in Canvas.
3. **Version history**: Artifact version comparison and rollback.
4. **AI iteration**: "Regenerate" / "Modify" buttons in Canvas that dispatch to Chat with context.
5. **Export/publish**: Direct publish actions from Canvas preview.

Each extension builds on the S5c skeleton without requiring layout restructuring.

## 7) Validation Plan

Automated:

1. `pnpm type-check` → PASS.

Manual QA:

1. Workspace center panel shows Canvas + Chat split when an Inbox item is selected.
2. Canvas shows empty state when no item is selected; Chat fills full height.
3. Clicking a campaign plan item in Inbox → Canvas renders campaign plan preview.
4. Clicking a content draft item in Inbox → Canvas renders content body preview.
5. Split handle resizes Canvas/Chat proportions.
6. Chat input shows artifact context indicator when Canvas has an active item.
7. Clearing context indicator returns chat to general mode.
8. All other Workspace functionality (Inbox actions, Session Rail, Chat) remains unaffected.

## 8) Acceptance Criteria

1. Canvas panel renders in Workspace center area above Chat.
2. Inbox item selection triggers Canvas preview update.
3. Campaign plan data renders in a structured, readable preview format.
4. Content draft body renders in a formatted text preview.
5. Chat carries artifact reference metadata when Canvas context is active.
6. Canvas/Chat split is adjustable via drag handle.
7. Empty state displays when no artifact is selected.
8. Canvas is read-only (no editing capabilities in S5c).
9. System is ready for incremental editing feature additions without layout changes.
