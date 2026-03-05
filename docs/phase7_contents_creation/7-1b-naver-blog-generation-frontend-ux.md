# Phase 7-1b: Naver Blog Content Generation — Frontend UX

- Date: 2026-03-05
- Status: Implemented (2026-03-05)
- Scope: Unified WYSIWYG editor, copy-to-clipboard, scheduler board integration, chat generation UX
- Depends on: Phase 7-1a (backend core), Phase 6-4a (scheduler board UX)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

Phase 7-1a delivers blog content generation on the backend, but the user has no way to:
1. See the generated blog content in a usable editor.
2. Copy the content for manual Naver Blog publishing.
3. View generated content on the scheduler board.
4. Track generation progress in real-time.

The current `ContentEditor` component has a split Preview/Edit layout designed for approval workflows. Naver Blog has no auto-publish API, so the UX must focus on **preview-edit-copy** rather than **approve-reject**.

---

## 2) Goals

1. **Unified WYSIWYG editor**: Replace split Preview + Edit textarea with a single editable surface (preview IS the editor).
2. **Copy button**: One-click copy of the full blog content for pasting into Naver Blog.
3. **Channel-aware action bar**: Naver Blog shows Copy + Save; other channels show Approve/Reject (future).
4. **Scheduler board integration**: Generated blog content appears on the board with `draft` status badge.
5. **Chat generation UX**: Loading state during generation, completion notification with editor open action.
6. **Local save confirmation**: Visual indicator that content was saved to local folder.

---

## 3) ContentEditor Refactor

### 3.1 Dispatcher pattern

File: `apps/desktop/src/components/scheduler/ContentEditor.tsx` (modify)

Refactor to channel-aware dispatcher:

```typescript
export const ContentEditor = (props: ContentEditorProps) => {
  const { content } = props;

  switch (content.channel) {
    case "naver_blog":
      return <BlogContentEditor {...props} />;
    // Future: case "instagram": return <CaptionEditor {...props} />;
    default:
      return <GenericContentEditor {...props} />;
  }
};
```

`GenericContentEditor` preserves the current approve/revise/reject layout for backward compatibility.

### 3.2 BlogContentEditor — Unified WYSIWYG

File: `apps/desktop/src/components/scheduler/BlogContentEditor.tsx` (new)

Layout:

```
┌──────────────────────────────────────────────┐
│ [← Back]  네이버 블로그  |  Status: Draft    │
│           {campaign_title or "온디맨드"}       │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │   # 블로그 제목                          │  │
│  │                                        │  │
│  │   본문 내용이 여기에 렌더링되고            │  │
│  │   클릭하면 바로 편집 가능                  │  │
│  │                                        │  │
│  │   ## 소제목                              │  │
│  │   ...                                  │  │
│  │                                        │  │
│  │   ---                                  │  │
│  │   #태그1 #태그2 #태그3                   │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│  글자수: 2,341자  |  마지막 저장: 14:30       │
├──────────────────────────────────────────────┤
│  [📋 복사하기]  [💾 저장]  [🔄 재생성]        │
│  ✅ 로컬 파일 저장 완료                       │
└──────────────────────────────────────────────┘
```

### 3.3 Editor implementation

For Phase 7-1b, use a **rich textarea** approach (not a full WYSIWYG library):

```typescript
const BlogContentEditor = ({ content, slotStatus, onBack }: BlogContentEditorProps) => {
  const [body, setBody] = useState(content.body ?? "");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localSaveStatus, setLocalSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const charCount = body.length;

  const handleChange = (newBody: string) => {
    setBody(newBody);
    setIsDirty(true);
  };

  return (
    <section className="blog-content-editor">
      <EditorHeader content={content} slotStatus={slotStatus} onBack={onBack} />
      <div className="blog-editor-surface">
        <textarea
          className="blog-editor-textarea"
          value={body}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="블로그 내용을 편집하세요..."
        />
      </div>
      <EditorStatusBar charCount={charCount} isDirty={isDirty} lastSavedAt={content.updated_at} />
      <BlogActionBar
        onCopy={handleCopy}
        onSave={handleSave}
        onRegenerate={handleRegenerate}
        isSaving={isSaving}
        isDirty={isDirty}
        localSaveStatus={localSaveStatus}
      />
    </section>
  );
};
```

**Why textarea instead of TipTap/Lexical for now:**
- Naver Blog paste target accepts plain text or HTML. A markdown textarea is the simplest correct solution.
- Full WYSIWYG (TipTap) can be a follow-up enhancement if users need inline formatting toolbar.
- Keeps bundle size minimal and avoids new dependency.

---

## 4) Action Bar

### 4.1 Copy to clipboard

```typescript
const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(body);
    setCopyStatus("copied"); // show "복사됨!" for 2 seconds
    setTimeout(() => setCopyStatus("idle"), 2000);
  } catch {
    setCopyStatus("error");
  }
};
```

Copy includes the full body (title + content + hashtags) as plain text.

### 4.2 Save (direct edit persist)

```typescript
const handleSave = async () => {
  setIsSaving(true);
  try {
    // 1. Save to DB via IPC → API
    await runtime.content.saveBody({
      contentId: content.id,
      body: body,
      expectedUpdatedAt: content.updated_at,
    });

    // 2. Save to local file (fire-and-forget)
    const localResult = await runtime.content.saveLocal({
      relativePath: buildLocalPath(content),
      fileName: buildFileName(content),
      body: body,
    });
    setLocalSaveStatus(localResult.ok ? "saved" : "error");

    setIsDirty(false);
  } catch (err) {
    if (isConflictError(err)) {
      setNotice("다른 곳에서 수정되었습니다. 새로고침 후 다시 시도해주세요.");
    }
  } finally {
    setIsSaving(false);
  }
};
```

### 4.3 Regenerate

```typescript
const handleRegenerate = () => {
  if (isDirty) {
    setConfirmDialog({
      message: "저장하지 않은 변경사항이 있습니다. 재생성하면 현재 내용이 대체됩니다.",
      onConfirm: () => triggerRegenerate(),
    });
    return;
  }
  triggerRegenerate();
};

const triggerRegenerate = () => {
  // Set content focus in chat context
  chatContext.setContentFocus(content.id, workflowHint?.workflowItemId ?? null);
  chatContext.expandChatPanel();
  chatContext.prefillMessage("이 블로그 글을 다시 생성해주세요");
};
```

---

## 5) Chat Generation UX

### 5.1 Generation loading state

File: `apps/desktop/src/components/chat/GlobalChatPanel.tsx` (modify)

When the `naverblog_generation` skill is active and generating:

```
┌─────────────────────────────┐
│ 🤖 네이버 블로그 글 생성 중... │
│ ████████░░░░░░ 생성 중        │
│                             │
│ 주제: 봄나들이 코스 추천       │
│ 예상 소요: 15-20초            │
└─────────────────────────────┘
```

Implementation: The skill's chat reply includes a `generating` status message first, then the completion message replaces it when done.

### 5.2 Completion notification

When generation is complete, the chat shows:

```
┌─────────────────────────────────────┐
│ ✅ 네이버 블로그 글이 생성되었습니다.  │
│                                     │
│ **봄나들이 코스 추천**                │
│ 2,341자 | Claude로 생성              │
│                                     │
│ [에디터에서 보기]  [복사하기]          │
└─────────────────────────────────────┘
```

The "에디터에서 보기" button opens the `BlogContentEditor` with the generated content by setting the scheduler's `selectedContentId`.

### 5.3 Chat message structure

The backend skill result `chatReply` is projected as a chat message. For blog generation, use a structured card format:

```typescript
// In skill result
chatReply: JSON.stringify({
  type: "blog_generation_complete",
  title: topic,
  charCount: generatedText.length,
  model: modelUsed,
  contentId: content.id,
  slotId: slot.id,
}),
```

The frontend `ChatMessage` renderer detects `type: "blog_generation_complete"` and renders the card with action buttons.

---

## 6) Scheduler Board Integration

### 6.1 Board card display

File: `apps/desktop/src/components/scheduler/SchedulerBoard.tsx` (modify)

Generated blog content appears on the board as a card:

```
┌──────────────────────┐
│ 📝 봄나들이 코스 추천   │
│ 네이버 블로그 | Draft   │
│ 2,341자               │
│ 3/10 (월)             │
└──────────────────────┘
```

Card fields sourced from `scheduled-content` query (Phase 6-3a):
- `title`: from slot title or content metadata topic
- `channel`: "naver_blog" → display as "네이버 블로그"
- `slot_status`: "draft" badge
- `char_count`: from content body length (if content_id is linked)
- `scheduled_date`: from slot

### 6.2 Card click → Editor open

Clicking a blog card on the board opens `BlogContentEditor` with the linked content. This reuses the existing `selectedContentId` state in `Scheduler.tsx`.

### 6.3 Status badge colors

| slot_status | Badge | Color |
|---|---|---|
| `scheduled` | 예정 | gray |
| `generating` | 생성 중 | blue (animated) |
| `draft` | 초안 | yellow |
| `skipped` | 건너뜀 | muted |
| `failed` | 실패 | red |

Note: For Naver Blog, `pending_approval` / `approved` / `published` are not used since there is no auto-publish.

---

## 7) Desktop IPC Bridge Updates

File: `apps/desktop/electron/main.mjs` (modify)

New IPC handler (also defined in 7-1a but listed here for frontend contract):

```javascript
ipcMain.handle("content:save-body", async (_, payload) => {
  // payload: { contentId, body, expectedUpdatedAt }
  // → PATCH /orgs/:orgId/contents/:contentId/body
});

ipcMain.handle("content:save-local", async (_, payload) => {
  // payload: { relativePath, fileName, body }
  // → fs.writeFile to watch folder
});
```

File: `apps/desktop/src/global.d.ts` (modify)

```typescript
interface DesktopRuntime {
  content: {
    saveBody: (params: { contentId: string; body: string; expectedUpdatedAt: string }) => Promise<{ ok: boolean; content: { id: string; body: string; updated_at: string } }>;
    saveLocal: (params: { relativePath: string; fileName: string; body: string }) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  };
  // ... existing methods
}
```

---

## 8) Styling

File: `apps/desktop/src/styles/scheduler.css` (modify)

```css
.blog-content-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--space-sm);
}

.blog-editor-surface {
  flex: 1;
  overflow-y: auto;
}

.blog-editor-textarea {
  width: 100%;
  min-height: 400px;
  padding: var(--space-md);
  font-family: 'Pretendard', sans-serif;
  font-size: 15px;
  line-height: 1.8;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  resize: vertical;
}

.blog-editor-textarea:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-primary-alpha);
}

.blog-action-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--border-default);
}

.blog-status-bar {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  padding: var(--space-xs) 0;
}
```

---

## 9) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/desktop/src/components/scheduler/ContentEditor.tsx` | Modify | Refactor to channel-aware dispatcher |
| `apps/desktop/src/components/scheduler/BlogContentEditor.tsx` | Create | Unified blog editor (preview=editor) |
| `apps/desktop/src/components/scheduler/BlogActionBar.tsx` | Create | Copy + Save + Regenerate action bar |
| `apps/desktop/src/components/scheduler/EditorStatusBar.tsx` | Create | Char count + save status bar |
| `apps/desktop/src/components/scheduler/GenericContentEditor.tsx` | Create | Current approve/reject layout preserved |
| `apps/desktop/src/components/chat/GlobalChatPanel.tsx` | Modify | Generation loading state + completion card |
| `apps/desktop/src/components/chat/BlogGenerationCard.tsx` | Create | Chat card for generation complete notification |
| `apps/desktop/src/components/scheduler/SchedulerBoard.tsx` | Modify | Blog card display with char count |
| `apps/desktop/src/context/ChatContext.tsx` | Modify | Content focus state + prefill message |
| `apps/desktop/src/pages/Scheduler.tsx` | Modify | Wire editor open from chat card action |
| `apps/desktop/src/styles/scheduler.css` | Modify | Blog editor styles |
| `apps/desktop/src/global.d.ts` | Modify | content.saveBody + content.saveLocal types |
| `apps/desktop/electron/main.mjs` | Modify | content:save-body + content:save-local IPC |
| `apps/desktop/electron/preload.mjs` | Modify | Expose content methods |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |

---

## 10) Acceptance Criteria

1. Blog content opens in unified WYSIWYG-style editor (single editable surface, not split preview/edit).
2. Copy button copies full blog text to clipboard with "복사됨!" feedback.
3. Save button persists edits to DB (optimistic concurrency) and local file.
4. Local save status indicator shows success/error.
5. Regenerate button opens chat panel with content context and pre-filled message.
6. Unsaved changes warning appears when navigating away from dirty editor.
7. Chat shows loading indicator during generation, then completion card with "에디터에서 보기" action.
8. Scheduler board displays blog cards with draft status badge and character count.
9. Clicking a blog card on the board opens the BlogContentEditor.
10. Existing approve/reject workflow for other channels is preserved (GenericContentEditor).
11. `pnpm --filter desktop type-check` passes.
12. Character count updates in real-time while editing.

---

## 11) Verification Plan

1. `pnpm --filter desktop type-check` — pass
2. `pnpm type-check` — pass (workspace-wide)
3. Manual: request blog generation in chat → verify loading state appears → completion card renders
4. Manual: click "에디터에서 보기" → verify BlogContentEditor opens with generated content
5. Manual: edit text in editor → verify char count updates, isDirty flag activates
6. Manual: click Save → verify DB update + local file written to correct path
7. Manual: click Copy → verify clipboard contains full text
8. Manual: click Regenerate with unsaved changes → verify confirmation dialog
9. Manual: verify blog card appears on scheduler board with correct status badge
10. Manual: click blog card on board → verify editor opens
11. Manual: verify GenericContentEditor still works for non-blog content

---

## 12) Decisions

**Why textarea over TipTap/Lexical:**
Naver Blog paste accepts plain text. A markdown-aware textarea is the simplest correct solution for v1. TipTap can be added later if users need inline formatting toolbar. Avoids new dependency and bundle size increase.

**Why channel-aware dispatcher:**
Different channels have fundamentally different action sets (Naver Blog: copy; Instagram: approve+publish). Dispatcher pattern keeps each editor focused and avoids conditional spaghetti.

**Why fire-and-forget local save:**
Local file save is a convenience feature. If it fails, the content is still in the DB. Users should not be blocked from using the editor.

**Why chat card for generation complete:**
Users may start generation and continue other work. The chat card provides a persistent notification with a direct action to open the editor. This is consistent with the existing chat-centric UX pattern.
