# Phase 6-4: Text Content Editor + Approval Wiring

- Date: 2026-03-05
- Status: Planning
- Scope: Full text content editing, direct save, approval workflow wiring, and chat context-awareness
- Depends on: Phase 6-3 (Scheduler data integration + slot status sync)
- Maps to: Architecture doc Section 11 → S-3

---

## 1) Problem

Phase 6-2 delivered a ContentEditor shell with approve/revise/reject buttons, but:

1. **No direct text editing with save**: The editor textarea exists but changes are not persisted independently of the approval flow. Users cannot fix a typo and save without also approving.
2. **Action dispatch is incomplete**: Approve/reject/revise buttons call `onSubmitAction` callback but the full pipeline (workflow resolution → slot sync → chat projection) is not end-to-end wired from the editor surface.
3. **No content-type-specific rendering**: Blog posts (markdown) and captions (plain text) use the same textarea. Blog content needs a markdown preview; captions need character count.
4. **No chat context-awareness**: When a content item is open in the editor, the Global Chat panel does not know which content the user is looking at. AI modification requests are not scoped to the focused content.
5. **No content navigation**: The Prev/Next buttons described in the architecture doc are missing. Users must return to the board to select another item.
6. **No version history display**: The editor does not show previous versions of the content (e.g., before/after AI revision).

---

## 2) Goals

1. **Direct text save**: Users can edit content body and save without triggering approval.
2. **Full approval wiring**: Approve/reject/skip actions flow from editor → workflow resolution → slot status sync → realtime update.
3. **Type-specific editors**: Caption editor (plain text + char count) and blog editor (markdown + preview).
4. **Chat context-awareness**: Global Chat knows the focused content_id and scopes AI requests to it.
5. **Content navigation**: Prev/Next through items matching current board filter.
6. **Regenerate action**: User can request full AI regeneration from the editor (routed through Chat).

---

## 3) Backend Changes

### 3.1 Direct content save API

Route: `PATCH /orgs/:orgId/contents/:contentId/body`

```typescript
// Request
{ body: string; expected_updated_at: string }

// Response
{ ok: boolean; content: { id, body, updated_at } }
```

Behavior:
- Validates `expected_updated_at` for optimistic concurrency (409 on mismatch).
- Updates `contents.body` and `contents.updated_at`.
- Does NOT change content status or workflow status.
- If `schedule_slots` row exists for this content, update `schedule_slots.updated_at` (triggers realtime push).

File: `apps/api/src/routes/sessions.ts` (add route)
File: `apps/api/src/orchestrator/service.ts` (add `updateContentBody()`)

### 3.2 Content version snapshot on save

Before overwriting `contents.body`, insert a snapshot into a lightweight version log:

```sql
-- Extend existing contents table or use metadata
-- Option: store versions in contents.metadata.version_history[]
```

Implementation: Append `{ body: previousBody, saved_at: timestamp, source: 'direct_edit' | 'ai_regeneration' }` to `contents.metadata.version_history` array (JSONB append). Cap at 10 versions.

This avoids a new table while providing undo capability.

### 3.3 Content detail API

Route: `GET /orgs/:orgId/contents/:contentId`

Returns full content row with metadata, linked campaign title, workflow status, and version history.

Needed for editor to load complete content context when navigating between items.

File: `apps/api/src/routes/sessions.ts`

### 3.4 Chat content-context message tagging

File: `apps/api/src/orchestrator/service.ts`

When processing a user message with `uiContext.focusContentId`:
- Load the focused content row.
- Inject content context into the orchestrator prompt: content body, channel, campaign context.
- Route AI response to content modification skill if intent matches.

File: `apps/api/src/orchestrator/skills/content-edit/index.ts` (new skill or extend existing)

Skill responsibilities:
- Receive user modification request + current content body.
- Generate modified content.
- Save new body to content row.
- Return confirmation message to chat.
- Trigger realtime update so editor refreshes.

---

## 4) Frontend Changes

### 4.1 Editor mode split: Caption vs Blog

File: `apps/desktop/src/components/scheduler/ContentEditor.tsx`

Refactor into dispatcher:

```typescript
function ContentEditor({ item, onBack, onNavigate }) {
  if (item.content_type === 'text' && item.channel === 'naver_blog') {
    return <BlogEditor item={item} ... />;
  }
  return <CaptionEditor item={item} ... />;
}
```

### 4.2 CaptionEditor component

File: `apps/desktop/src/components/scheduler/CaptionEditor.tsx` (new)

Features:
- Plain textarea for content body.
- Character count display (Instagram: 2200 max, Facebook: 63206 max).
- Channel-specific character limit indicator (warning at 90%, error at 100%).
- Hashtag extraction and display as tags below textarea.
- **Save button**: Calls `PATCH /contents/:id/body` — independent of approval.
- **Dirty state tracking**: Unsaved changes warning on navigation away.
- Action bar: Approve / Regenerate / Skip / Reschedule.

### 4.3 BlogEditor component

File: `apps/desktop/src/components/scheduler/BlogEditor.tsx` (new)

Features:
- Split view: markdown editor (left) + rendered preview (right).
- Markdown rendering via `react-markdown` or equivalent (check existing dependencies).
- Line numbers in editor.
- **Save button**: Same as CaptionEditor.
- **Dirty state tracking**.
- When Global Chat is collapsed, editor expands to full width with side-by-side layout.
- When Global Chat is open, editor uses single-column layout (edit above, preview below).

### 4.4 Content navigation (Prev/Next)

File: `apps/desktop/src/pages/Scheduler.tsx`

Pass the ordered list of `scheduledItems` (filtered by current board filters) to ContentEditor.

ContentEditor receives:
- `currentIndex`: position in the filtered list.
- `onNavigate(direction: 'prev' | 'next')`: callback that updates `selectedContentId`.
- Displays: `"3 of 12"` indicator.

Behavior:
- If dirty (unsaved changes), prompt before navigating.
- Prev/Next wraps around at boundaries (or disables at edges).

### 4.5 Chat context-awareness integration

File: `apps/desktop/src/components/chat/GlobalChatPanel.tsx`

When ContentEditor is active:
- Show context banner: `"Editing: {date} {channel} — {campaign_title}"`
- `[✕ Clear context]` button to detach.
- Pass `uiContext: { focusContentId, focusWorkflowItemId }` in every message sent while context is active.

File: `apps/desktop/src/context/ChatContext.tsx`

Add state:
- `focusedContentId: string | null`
- `focusedWorkflowItemId: string | null`
- `setContentFocus(contentId, workflowItemId)` / `clearContentFocus()`

When `focusedContentId` is set, append to outgoing messages:
```typescript
uiContext: {
  focusContentId: focusedContentId,
  focusWorkflowItemId: focusedWorkflowItemId,
}
```

### 4.6 Approval action wiring

File: `apps/desktop/src/components/scheduler/CaptionEditor.tsx` (and BlogEditor)

Action handlers:

```typescript
const handleApprove = async () => {
  // 1. If dirty, save first
  if (isDirty) await saveBody();
  // 2. Dispatch approve via ChatContext.dispatchCardAction
  await dispatchCardAction('approve', workflowItemId, { editedBody: currentBody });
  // 3. Slot status updated via realtime subscription (no manual refresh)
};

const handleSkip = async () => {
  await dispatchCardAction('reject', workflowItemId, { reason: 'skipped' });
};

const handleRegenerate = () => {
  // Open chat panel if collapsed
  // Set content context
  // Pre-fill message: "이 콘텐츠를 다시 생성해주세요"
  setContentFocus(contentId, workflowItemId);
  expandChatPanel();
  // User then describes what they want changed
};
```

### 4.7 Regenerate via Chat flow

When user clicks "Regenerate" in the editor:
1. Chat panel expands (if collapsed).
2. Content context banner appears.
3. Chat input is focused with placeholder: "What would you like to change?"
4. User types modification request.
5. AI generates new content body scoped to the focused content.
6. Editor preview updates via realtime subscription.
7. New content version appended to version_history.

### 4.8 Version history sidebar

File: `apps/desktop/src/components/scheduler/VersionHistory.tsx` (new)

- Expandable sidebar or dropdown showing version_history from content metadata.
- Each entry: timestamp + source (direct_edit / ai_regeneration) + truncated preview.
- Click to view: shows diff or full previous body.
- "Restore" button: copies previous body into editor textarea (user must save manually).
- Max 10 versions displayed.

---

## 5) Desktop IPC Bridge Updates

File: `apps/desktop/electron/main.mjs`

New IPC handlers:
- `content:save-body` → `PATCH /orgs/:orgId/contents/:contentId/body`
- `content:get-detail` → `GET /orgs/:orgId/contents/:contentId`

File: `apps/desktop/electron/preload.mjs` / `preload.cjs`

New runtime methods:
- `content.saveBody({ contentId, body, expectedUpdatedAt })`
- `content.getDetail({ contentId })`

File: `apps/desktop/src/global.d.ts`

Update `DesktopRuntime` type.

---

## 6) Data Flow

### Direct Edit + Save

```
User edits caption in CaptionEditor
  → isDirty = true, Save button enabled
  → User clicks Save
  → IPC: content.saveBody({ contentId, body, expectedUpdatedAt })
  → API: PATCH /contents/:id/body
    → Snapshot previous body to metadata.version_history
    → Update contents.body + updated_at
    → Touch schedule_slots.updated_at (triggers realtime)
  → Response: { ok, content }
  → Editor: isDirty = false, updated_at synced
```

### Approve from Editor

```
User clicks Approve in CaptionEditor
  → If dirty: auto-save first
  → dispatchCardAction('approve', workflowItemId, { editedBody })
  → Backend: resolveWorkflowItem(approved)
    → workflow_items.status = approved
    → contents.status = published, published_at = now
    → schedule_slots.slot_status = approved (via syncSlotStatusFromWorkflow)
  → Realtime: slot update pushed
  → Board card badge: "Approved"
  → Editor: navigate to next pending item (if any)
```

### AI Modification via Chat

```
User clicks Regenerate → Chat panel opens with content context
  → User: "톤을 더 캐주얼하게 바꿔줘"
  → Message sent with uiContext.focusContentId
  → Orchestrator: detects content-edit intent + focused content
  → AI: generates modified body
  → Backend: updates contents.body, appends version_history
  → Realtime: schedule_slots updated_at triggers push
  → Editor: refreshes preview with new body
  → Chat: "콘텐츠를 수정했습니다. 에디터에서 확인해주세요."
```

---

## 7) Acceptance Criteria

1. Users can edit caption text and save independently of approval (Save button works).
2. Blog content renders as markdown preview alongside the editor.
3. Character count displays for caption content with channel-specific limits.
4. Approve action from editor triggers full workflow resolution + slot status sync.
5. Skip action marks slot as skipped.
6. Regenerate opens Chat with content context; AI modification updates editor in real-time.
7. Prev/Next navigation works across filtered content items.
8. Unsaved changes prompt appears when navigating away from dirty editor.
9. Chat context banner shows when editing content; clears when user clicks ✕.
10. Version history shows up to 10 previous versions with restore capability.
11. Optimistic concurrency (409) prevents lost updates on concurrent edits.
12. API type-check passes.
13. Desktop type-check passes.
14. Unit tests cover: direct save flow, approval wiring, version history append, content-context message tagging.

---

## 8) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/routes/sessions.ts` | Modify | Add content save + detail routes |
| `apps/api/src/orchestrator/service.ts` | Modify | Add `updateContentBody()`, content-context handling |
| `apps/api/src/orchestrator/skills/content-edit/index.ts` | Create | Content modification skill for chat-driven edits |
| `apps/desktop/electron/main.mjs` | Modify | New IPC handlers for content save/detail |
| `apps/desktop/electron/preload.mjs` | Modify | New runtime methods |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |
| `apps/desktop/src/global.d.ts` | Modify | Updated runtime types |
| `apps/desktop/src/pages/Scheduler.tsx` | Modify | Content navigation state, pass items to editor |
| `apps/desktop/src/components/scheduler/ContentEditor.tsx` | Modify | Refactor to dispatcher (Caption vs Blog) |
| `apps/desktop/src/components/scheduler/CaptionEditor.tsx` | Create | Caption-specific editor with char count |
| `apps/desktop/src/components/scheduler/BlogEditor.tsx` | Create | Markdown editor with preview |
| `apps/desktop/src/components/scheduler/VersionHistory.tsx` | Create | Version history sidebar |
| `apps/desktop/src/components/chat/GlobalChatPanel.tsx` | Modify | Content context banner |
| `apps/desktop/src/context/ChatContext.tsx` | Modify | Content focus state + message tagging |

---

## 9) Verification Plan

1. `pnpm --filter @repo/api type-check`
2. `pnpm --filter desktop type-check`
3. `pnpm --filter @repo/api test:unit` — new tests for content save, version history, content-edit skill
4. Manual: open a caption content in editor, edit text, save — verify body persisted without status change
5. Manual: open a blog content, verify markdown preview renders correctly
6. Manual: approve from editor — verify workflow + slot + content status all update
7. Manual: click Regenerate — verify Chat opens with context banner, AI modifies content, editor refreshes
8. Manual: navigate Prev/Next — verify correct item loads, dirty warning appears if unsaved
9. Manual: check version history — verify previous versions listed, restore works
