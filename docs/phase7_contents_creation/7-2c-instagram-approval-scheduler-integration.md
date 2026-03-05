# Phase 7-2c: Instagram Content — Approval Workflow + Scheduler Integration + Local Save

- Date: 2026-03-05
- Status: Planning
- Scope: Approve/revise/reject actions for Instagram content, scheduler board visual integration, local file archival, slot status lifecycle completion
- Depends on: Phase 7-2b (canvas editor), Phase 7-2a (content persistence + slot linking), Phase 3-3 (workflow action contract)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

Phase 7-2b delivers the visual editor for Instagram content, but:

1. **No approval actions**: Users can view and edit but cannot approve, request revision, or reject content. Unlike Naver Blog (copy-only), Instagram content needs an approval workflow because it will eventually be auto-published.
2. **No slot status lifecycle completion**: Content moves from `scheduled` → `generating` → `draft` but never transitions to `approved` / `published` / `skipped`.
3. **No scheduler board visual differentiation**: Instagram cards on the board show no image thumbnail or visual indicator beyond text.
4. **No structured local archival**: Composed images and captions are not systematically saved to the user's local folder.
5. **No revision flow**: When a user requests revision, there is no mechanism to re-trigger generation with feedback context.

---

## 2) Goals

1. **Approval action bar in editor**: Approve / Request Revision / Skip actions wired to workflow resolution + slot status sync.
2. **Slot status lifecycle**: Complete the `draft` → `approved` → (future: `published`) transition with guard rails.
3. **Scheduler board thumbnails**: Instagram cards show a small thumbnail of the composed image.
4. **Local file archival**: On approve, save composed image + caption text file to local folder.
5. **Revision flow**: Request Revision → chat opens with content context + user feedback → AI regenerates → editor refreshes.
6. **Skip flow**: Mark slot as `skipped` → card grayed out on board.

---

## 3) Approval Workflow

### 3.1 Action bar extension

File: `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx` (modify)

Add approval action section below the existing InstagramActionBar:

```
┌──────────────────────────────────────────────────────┐
│  ... (existing editor content from 7-2b) ...         │
├──────────────────────────────────────────────────────┤
│  [⬇ 이미지 다운로드]  [📋 캡션 복사]  [💾 저장]  [🔄 재생성]  │
├──────────────────────────────────────────────────────┤
│  Workflow: v1 (draft)                                │
│  [✅ 승인]  [✏️ 수정 요청]  [⏭ 건너뛰기]             │
│                                                      │
│  수정 요청 사유: ┌────────────────────────┐           │
│                 │ (입력)                   │           │
│                 └────────────────────────┘           │
└──────────────────────────────────────────────────────┘
```

### 3.2 Approval action handler

```typescript
const handleApprove = async () => {
  // 1. Auto-save if dirty
  if (isDirty) await handleSave();

  // 2. Dispatch approval via existing workflow contract (Phase 3-3)
  await onSubmitAction({
    sessionId,
    workflowItemId: workflowHint.workflowItemId,
    expectedVersion: workflowHint.version,
    actionId: "approve",
    eventType: "content_approved",
    contentId: content.id,
    editedBody: caption, // latest caption
  });

  // 3. Save approved content to local folder
  await saveApprovedContentLocally();

  // 4. Navigate to next pending item
  onNavigateNext?.();
};
```

### 3.3 Backend approval resolution

File: `apps/api/src/orchestrator/service.ts` (existing workflow resolution path)

When content is approved:

```typescript
// Existing workflow resolution triggers:
// 1. workflow_items.status → "approved"
// 2. contents.status → "approved"

// Additional for Instagram:
// 3. schedule_slots.slot_status → "approved" (via syncSlotStatusFromWorkflow)
// 4. contents.metadata.approved_at → timestamp
// 5. contents.metadata.approved_caption → final caption text
```

The existing `syncSlotStatusFromWorkflow` function (Phase 6-3a `scheduler-slot-transition.ts`) handles the slot status update automatically when workflow status changes.

### 3.4 Slot status transitions (Instagram lifecycle)

```
scheduled → generating → draft → approved → published (future)
                           ↓
                         skipped
                           ↓
                     revision_requested → generating → draft (loop)
```

File: `apps/api/src/orchestrator/scheduler-slot-transition.ts` (modify)

Add `revision_requested` to valid transitions:

```typescript
const VALID_TRANSITIONS: Record<SlotStatus, SlotStatus[]> = {
  scheduled: ["generating", "skipped"],
  generating: ["draft", "failed"],
  draft: ["approved", "skipped", "revision_requested"],
  revision_requested: ["generating"],
  approved: ["published"],         // future: auto-publish
  published: [],                   // terminal
  skipped: [],                     // terminal
  failed: ["scheduled"],           // retry
};
```

Note: `revision_requested` is a new status. Requires migration.

### 3.5 Migration

File: `supabase/migrations/20260305_phase_7_2c_revision_status.sql` (new)

```sql
-- Add revision_requested to slot_status check constraint
ALTER TABLE public.schedule_slots
  DROP CONSTRAINT IF EXISTS schedule_slots_slot_status_check;

ALTER TABLE public.schedule_slots
  ADD CONSTRAINT schedule_slots_slot_status_check CHECK (
    slot_status IN (
      'scheduled',
      'generating',
      'pending_approval',
      'approved',
      'published',
      'skipped',
      'failed',
      'revision_requested'
    )
  );
```

---

## 4) Revision Flow

### 4.1 Request Revision action

```typescript
const handleRequestRevision = async () => {
  if (!revisionReason.trim()) {
    setNotice("수정 사유를 입력해주세요.");
    return;
  }

  // 1. Update slot status → revision_requested
  await onSubmitAction({
    sessionId,
    workflowItemId: workflowHint.workflowItemId,
    expectedVersion: workflowHint.version,
    actionId: "request_revision",
    eventType: "content_rejected",
    contentId: content.id,
    mode: "revision",
    reason: revisionReason.trim(),
  });

  // 2. Open chat with revision context
  chatContext.setContentFocus(content.id, workflowHint.workflowItemId);
  chatContext.expandChatPanel();
  chatContext.prefillMessage(`이 인스타 게시물을 수정해줘: ${revisionReason}`);
};
```

### 4.2 Backend revision handling

When `instagram_generation` skill receives a message with `focusContentId` and revision intent:

1. Load existing content (caption + overlay + template + image paths) from `contents` row.
2. Include revision reason in the generation prompt as feedback context.
3. Re-generate caption + overlay text with revision guidance.
4. Re-compose image with updated text.
5. Update `contents` row with new body/metadata.
6. Update `schedule_slots.slot_status` → `generating` → `draft`.
7. Chat reply: "인스타 게시물을 수정했습니다. 에디터에서 확인해주세요."

File: `apps/api/src/orchestrator/skills/instagram-generation/generate.ts` (modify)

```typescript
// Revision prompt addition
if (revisionContext) {
  prompt += `\n\n[REVISION_FEEDBACK]\nThe user requested changes: "${revisionContext.reason}"\nPrevious caption: "${revisionContext.previousCaption}"\nAdjust the content based on this feedback while maintaining brand voice.`;
}
```

### 4.3 Skip action

```typescript
const handleSkip = async () => {
  await onSubmitAction({
    sessionId,
    workflowItemId: workflowHint.workflowItemId,
    expectedVersion: workflowHint.version,
    actionId: "reject",
    eventType: "content_rejected",
    contentId: content.id,
    reason: "skipped",
  });
  // slot_status → "skipped" via syncSlotStatusFromWorkflow
  onNavigateNext?.();
};
```

---

## 5) Scheduler Board Visual Integration

### 5.1 Instagram card with thumbnail

File: `apps/desktop/src/components/scheduler/SchedulerBoard.tsx` (modify)

Instagram cards on the board include a small image thumbnail:

```
┌──────────────────────────┐
│ ┌────┐ 봄나들이 행사 홍보  │
│ │ 📷 │ 인스타그램 | Draft  │
│ │    │ 450자               │
│ └────┘ 3/10 (월)          │
└──────────────────────────┘
```

```typescript
// In SchedulerBoard card renderer
const renderCardContent = (item: ScheduledContentItem) => {
  const thumbnailUrl = item.metadata?.composed_image_url;

  return (
    <div className="board-card" onClick={() => onSelectContent(item.content_id)}>
      {item.channel === "instagram" && thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          className="board-card-thumbnail"
          loading="lazy"
        />
      )}
      <div className="board-card-info">
        <span className="board-card-title">{item.title}</span>
        <span className="board-card-meta">
          {channelLabel(item.channel)} | {statusBadge(item.slot_status)}
        </span>
      </div>
    </div>
  );
};
```

### 5.2 Status badge styling

Instagram-specific badge additions:

| slot_status | Badge | Color |
|---|---|---|
| `revision_requested` | 수정 요청 | orange |
| `approved` | 승인됨 | green |

These extend the existing badge colors from Phase 7-1b.

### 5.3 Board card thumbnail styling

```css
.board-card-thumbnail {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.board-card {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
```

---

## 6) Local File Archival

### 6.1 Save on approve

When content is approved, automatically save to local folder:

```typescript
const saveApprovedContentLocally = async () => {
  const folderPath = buildLocalContentPath(content);

  // 1. Save composed image
  await runtime.content.saveLocal({
    relativePath: folderPath,
    fileName: `${content.id}_instagram.png`,
    body: null, // binary save — use downloadAndSave instead
  });

  // 2. Download image from Supabase Storage → save locally
  await runtime.content.downloadAndSaveImage({
    imageUrl: content.metadata.composed_image_url,
    relativePath: folderPath,
    fileName: `instagram_${formatDate(content.scheduled_at)}.png`,
  });

  // 3. Save caption as text file
  await runtime.content.saveLocal({
    relativePath: folderPath,
    fileName: `instagram_${formatDate(content.scheduled_at)}_caption.txt`,
    body: `${caption}\n\n${hashtags.map(t => `#${t}`).join(" ")}`,
  });
};
```

### 6.2 Local folder structure

```
{watch_root}/
  contents/
    {campaign_title}/
      2026-03-10_instagram/
        instagram_2026-03-10.png          ← composed image
        instagram_2026-03-10_caption.txt  ← caption + hashtags
    ondemand/
      2026-03-05_instagram/
        instagram_2026-03-05.png
        instagram_2026-03-05_caption.txt
```

### 6.3 IPC handler for image download + save

File: `apps/desktop/electron/main.mjs` (modify)

```javascript
ipcMain.handle("content:download-and-save-image", async (_, payload) => {
  const watchPath = getDesktopConfig().watch_path;
  if (!watchPath) return { ok: false, error: "no_watch_path" };

  // Path traversal defense (same as 7-1a hardening)
  const targetDir = path.resolve(watchPath, payload.relativePath);
  if (!targetDir.startsWith(path.resolve(watchPath))) {
    return { ok: false, error: "path_traversal_blocked" };
  }

  await fs.mkdir(targetDir, { recursive: true });

  const response = await fetch(payload.imageUrl);
  if (!response.ok) return { ok: false, error: "download_failed" };

  const buffer = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(targetDir, payload.fileName);
  await fs.writeFile(filePath, buffer);

  return { ok: true, filePath };
});
```

---

## 7) Content Navigation

### 7.1 Navigate to next pending item after action

When user approves or skips, the editor automatically navigates to the next item with `slot_status: "draft"`:

```typescript
const onNavigateNext = () => {
  const pendingItems = scheduledItems.filter(
    (item) => item.slot_status === "draft" && item.content_id !== content.id
  );

  if (pendingItems.length > 0) {
    setSelectedContentId(pendingItems[0].content_id);
  } else {
    // No more pending items — return to board
    setSelectedContentId(null);
  }
};
```

### 7.2 Item counter display

In the editor header:

```
승인 대기: 3/12 항목  |  [← 이전] [다음 →]
```

---

## 8) Desktop IPC Bridge Updates

File: `apps/desktop/src/global.d.ts` (modify)

```typescript
interface DesktopRuntime {
  content: {
    saveBody: (...) => Promise<...>;       // from 7-1b
    saveLocal: (...) => Promise<...>;      // from 7-1a
    recompose: (...) => Promise<...>;      // from 7-2b
    downloadImage: (...) => Promise<...>;  // from 7-2b
    downloadAndSaveImage: (params: {       // NEW in 7-2c
      imageUrl: string;
      relativePath: string;
      fileName: string;
    }) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  };
}
```

---

## 9) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx` | Modify | Add approval action section |
| `apps/desktop/src/components/scheduler/instagram/ApprovalActionBar.tsx` | Create | Approve/Revise/Skip buttons + revision reason |
| `apps/desktop/src/components/scheduler/SchedulerBoard.tsx` | Modify | Instagram card thumbnails + new status badges |
| `apps/desktop/src/pages/Scheduler.tsx` | Modify | Content navigation (next pending) |
| `apps/desktop/src/styles/scheduler.css` | Modify | Thumbnail, badge, approval bar styles |
| `apps/desktop/src/global.d.ts` | Modify | downloadAndSaveImage type |
| `apps/desktop/electron/main.mjs` | Modify | content:download-and-save-image IPC |
| `apps/desktop/electron/preload.mjs` | Modify | Expose downloadAndSaveImage |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |
| `apps/api/src/orchestrator/scheduler-slot-transition.ts` | Modify | Add revision_requested to valid transitions |
| `apps/api/src/orchestrator/skills/instagram-generation/generate.ts` | Modify | Revision context in generation prompt |
| `apps/api/src/orchestrator/scheduler-status.ts` | Modify | Add revision_requested to SlotStatus type |
| `supabase/migrations/20260305_phase_7_2c_revision_status.sql` | Create | Add revision_requested to constraint |

---

## 10) Acceptance Criteria

1. Approve button in editor triggers workflow resolution → `contents.status: "approved"` + `slot_status: "approved"`.
2. Approved content is automatically saved to local folder (image PNG + caption TXT).
3. Request Revision with reason opens chat panel → AI regenerates with feedback context → editor refreshes.
4. Slot status transitions to `revision_requested` → `generating` → `draft` on revision.
5. Skip action marks `slot_status: "skipped"` → card grayed out on board.
6. Scheduler board shows image thumbnails for Instagram cards.
7. After approve/skip, editor navigates to next pending `draft` item.
8. Item counter shows "승인 대기: N/M 항목".
9. `revision_requested` badge appears orange on board cards.
10. Local file archival follows folder structure convention (campaign vs ondemand).
11. Path traversal defense blocks `..` segments in local save paths.
12. `pnpm --filter desktop type-check` passes.
13. `pnpm --filter @repo/api type-check` passes.
14. Existing workflow resolution contract (Phase 3-3) is preserved — no regression.

---

## 11) Verification Plan

1. `pnpm --filter @repo/api type-check` — pass
2. `pnpm --filter desktop type-check` — pass
3. `pnpm type-check` — pass (workspace-wide)
4. `pnpm --filter @repo/api test:unit` — new tests for revision status transitions
5. Manual: approve content → verify workflow + slot + content status all update to approved
6. Manual: verify local folder contains PNG + caption TXT after approve
7. Manual: request revision with reason → verify chat opens with context → AI regenerates → editor shows new content
8. Manual: skip content → verify slot_status = skipped, card grayed on board
9. Manual: approve → verify editor navigates to next draft item
10. Manual: verify board shows Instagram thumbnails for items with composed images
11. Manual: verify item counter "승인 대기: N/M" updates after each action
12. Apply migration → verify revision_requested status is accepted in schedule_slots

---

## 12) Decisions

**Why approval workflow for Instagram (unlike Naver Blog):**
Instagram content will eventually support auto-publish via Instagram Graph API (future phase). Approval gates the publish action. Naver Blog has no API for auto-publish, so copy-only was sufficient.

**Why auto-navigate after action:**
Users typically review content sequentially. Reducing clicks by auto-navigating to the next pending item improves review throughput. Returning to the board when all items are reviewed provides a natural completion signal.

**Why revision loops through chat:**
The chat-centric architecture (established in Phase 3-3) already handles content modification requests. Re-using this path for revision keeps the interaction model consistent and allows natural language feedback ("톤을 더 밝게 해줘") rather than structured form input.

**Why local save on approve (not on generate):**
Saving draft content locally creates clutter (user may skip or revise). Only approved content represents the user's final choice and is worth archiving. Users can still manually download from the editor at any time.

**Why separate image + caption files locally:**
Users may want to upload the image to Instagram and paste the caption separately. Two files is more practical than a single combined file.
