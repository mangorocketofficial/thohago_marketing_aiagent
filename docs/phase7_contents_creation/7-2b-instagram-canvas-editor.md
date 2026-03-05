# Phase 7-2b: Instagram Content — Canvas Editor + Template Rendering

- Date: 2026-03-05
- Status: Planning
- Scope: Visual editor for Instagram content (image preview, text editing, template switching, image replacement), integrated into scheduler ContentEditor dispatcher
- Depends on: Phase 7-2a (composed image generation, template system, Supabase Storage), Phase 7-1b (ContentEditor dispatcher pattern)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

Phase 7-2a generates composed Instagram images on the backend, but the user has no way to:
1. Preview the composed image in the app.
2. Edit text overlays directly on the image.
3. Switch templates after generation.
4. Replace the user photo without full regeneration.
5. Make fine adjustments (text position, font size, color) before finalizing.

The current `ContentEditor` was refactored in 7-1b into a channel-aware dispatcher. Instagram needs a visual canvas editor, not a text editor.

---

## 2) Goals

1. **Image preview**: Display the composed Instagram image in the editor area.
2. **Inline text editing**: Click overlay text on the image to edit it directly.
3. **Template switching**: Change template and re-compose without regenerating caption/images.
4. **Image replacement**: Swap user photo from activity folder without regenerating text.
5. **Caption editing**: Edit the caption text (separate from overlay text) in a textarea below the image.
6. **Re-compose on edit**: When overlay text, template, or image changes → trigger server-side ffmpeg re-compose → refresh preview.
7. **Action bar**: Download image / Copy caption / Save / Regenerate.

---

## 3) Editor Architecture

### 3.1 ContentEditor dispatcher extension

File: `apps/desktop/src/components/scheduler/ContentEditor.tsx` (modify)

```typescript
export const ContentEditor = (props: ContentEditorProps) => {
  const { content } = props;

  switch (content.channel) {
    case "naver_blog":
      return <BlogContentEditor {...props} />;
    case "instagram":
      return <InstagramContentEditor {...props} />;
    default:
      return <GenericContentEditor {...props} />;
  }
};
```

### 3.2 InstagramContentEditor layout

File: `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx` (new)

```
┌──────────────────────────────────────────────────────┐
│ [← Back]  인스타그램  |  Status: Draft               │
│           {campaign_title or "온디맨드"}               │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  │         ┌──────────────────────┐               │  │
│  │         │                      │               │  │
│  │         │    [User Photo]      │               │  │
│  │         │                      │               │  │
│  │         └──────────────────────┘               │  │
│  │                                                │  │
│  │         [ 봄나들이 행사 ]  ← click to edit     │  │
│  │         [ 함께해요! ]      ← click to edit     │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│          Composed Image Preview (1080x1080)          │
│                                                      │
├──────────────────────────────────────────────────────┤
│  Template: [중앙 이미지 ▼]  Image: [event.jpg ✕ 교체] │
├──────────────────────────────────────────────────────┤
│  Caption                                             │
│  ┌────────────────────────────────────────────────┐  │
│  │ 봄 나들이 행사에 함께해요! 🌸                     │  │
│  │ ...                                            │  │
│  │ #봄나들이 #행사 #함께해요                         │  │
│  └────────────────────────────────────────────────┘  │
│  450자 / 2,200자 max                                 │
├──────────────────────────────────────────────────────┤
│  [⬇ 이미지 다운로드]  [📋 캡션 복사]  [💾 저장]  [🔄 재생성]  │
└──────────────────────────────────────────────────────┘
```

### 3.3 Component hierarchy

```
InstagramContentEditor
  ├── EditorHeader                    (shared with BlogContentEditor)
  ├── ImagePreview                    (composed image display)
  │   ├── OverlayTextEdit (main)     (inline text editing on image)
  │   └── OverlayTextEdit (sub)
  ├── TemplateImageControls           (template selector + image replacement)
  ├── CaptionEditor                   (textarea for caption + hashtags)
  │   └── CharCountBar
  └── InstagramActionBar              (download + copy + save + regenerate)
```

---

## 4) Image Preview Component

### 4.1 ImagePreview

File: `apps/desktop/src/components/scheduler/instagram/ImagePreview.tsx` (new)

Displays the composed image from Supabase Storage URL:

```typescript
type ImagePreviewProps = {
  imageUrl: string;           // Supabase Storage public URL
  width: number;              // template width (1080)
  height: number;             // template height (1080)
  overlayMain: string;
  overlaySub: string;
  isRecomposing: boolean;     // show spinner overlay during re-compose
  onEditOverlayMain: (text: string) => void;
  onEditOverlaySub: (text: string) => void;
};

const ImagePreview = ({ imageUrl, isRecomposing, ...props }: ImagePreviewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);

  // Scale 1080px image to fit editor width
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      setDisplayScale(containerWidth / props.width);
    }
  }, [props.width]);

  return (
    <div className="image-preview-container" ref={containerRef}>
      <img
        src={imageUrl}
        alt="Instagram post preview"
        className="image-preview-img"
        style={{ width: "100%", aspectRatio: `${props.width}/${props.height}` }}
      />

      {/* Overlay text edit zones (positioned over the image) */}
      <OverlayTextEdit
        value={props.overlayMain}
        onChange={props.onEditOverlayMain}
        className="overlay-main-edit"
        maxLength={15}
        placeholder="메인 텍스트"
      />
      <OverlayTextEdit
        value={props.overlaySub}
        onChange={props.onEditOverlaySub}
        className="overlay-sub-edit"
        maxLength={25}
        placeholder="서브 텍스트"
      />

      {isRecomposing && (
        <div className="image-preview-loading">
          <span>이미지 재구성 중...</span>
        </div>
      )}
    </div>
  );
};
```

### 4.2 OverlayTextEdit

File: `apps/desktop/src/components/scheduler/instagram/OverlayTextEdit.tsx` (new)

Inline text editing directly on the image preview:

```typescript
type OverlayTextEditProps = {
  value: string;
  onChange: (text: string) => void;
  className: string;
  maxLength: number;
  placeholder: string;
};

const OverlayTextEdit = ({ value, onChange, className, maxLength, placeholder }: OverlayTextEditProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    setIsEditing(true);
    setDraft(value);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (draft !== value) {
      onChange(draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      inputRef.current?.blur();
    }
    if (e.key === "Escape") {
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className={`${className} editing`}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
      />
    );
  }

  return (
    <span className={`${className} display`} onClick={handleClick} title="클릭하여 수정">
      {value || placeholder}
    </span>
  );
};
```

---

## 5) Template & Image Controls

### 5.1 TemplateImageControls

File: `apps/desktop/src/components/scheduler/instagram/TemplateImageControls.tsx` (new)

```typescript
type TemplateImageControlsProps = {
  currentTemplateId: string;
  currentImagePath: string | null;
  availableTemplates: Array<{ id: string; nameKo: string }>;
  onChangeTemplate: (templateId: string) => void;
  onChangeImage: () => void;  // opens image picker
};

const TemplateImageControls = (props: TemplateImageControlsProps) => {
  return (
    <div className="template-image-controls">
      <div className="control-group">
        <label>템플릿</label>
        <select
          value={props.currentTemplateId}
          onChange={(e) => props.onChangeTemplate(e.target.value)}
        >
          {props.availableTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.nameKo}</option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <label>이미지</label>
        {props.currentImagePath ? (
          <span className="image-tag">
            {path.basename(props.currentImagePath)}
            <button type="button" onClick={props.onChangeImage}>교체</button>
          </span>
        ) : (
          <button type="button" onClick={props.onChangeImage}>이미지 선택</button>
        )}
      </div>
    </div>
  );
};
```

### 5.2 Image picker modal

File: `apps/desktop/src/components/scheduler/instagram/ImagePickerModal.tsx` (new)

Shows activity folder images in a grid for manual selection:

```typescript
type ImagePickerModalProps = {
  images: Array<{ fileName: string; filePath: string; fileSize: number }>;
  onSelect: (filePath: string) => void;
  onClose: () => void;
};

const ImagePickerModal = ({ images, onSelect, onClose }: ImagePickerModalProps) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="image-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>이미지 선택</h3>
        <div className="image-grid">
          {images.map((img) => (
            <div
              key={img.filePath}
              className="image-grid-item"
              onClick={() => { onSelect(img.filePath); onClose(); }}
            >
              <img src={`file://${img.filePath}`} alt={img.fileName} />
              <span>{img.fileName}</span>
            </div>
          ))}
        </div>
        <button type="button" onClick={onClose}>취소</button>
      </div>
    </div>
  );
};
```

---

## 6) Re-Compose Flow

When user edits overlay text, changes template, or swaps image:

```
User edits overlay text on preview
  → Local state updates immediately (optimistic UI)
  → Debounce 800ms
  → IPC: content.recompose({
      contentId,
      templateId,
      overlayMain,
      overlaySub,
      imagePaths
    })
  → API: POST /orgs/:orgId/contents/:contentId/recompose
    → ffmpeg re-compose with new parameters
    → Upload new image to Supabase Storage (overwrite)
    → Update contents.metadata
  → Response: { ok, newImageUrl }
  → ImagePreview refreshes with new URL + cache-bust query param
```

### 6.1 Recompose API

Route: `POST /orgs/:orgId/contents/:contentId/recompose`

```typescript
// Request
{
  templateId: string;
  overlayMain: string;
  overlaySub: string;
  imagePaths?: string[];  // only if image changed
}

// Response
{
  ok: boolean;
  imageUrl: string;       // new Supabase Storage URL
  updated_at: string;
}
```

File: `apps/api/src/routes/sessions.ts` (modify — add route)
File: `apps/api/src/orchestrator/service.ts` (modify — add `recomposeContent()`)

### 6.2 IPC handler

File: `apps/desktop/electron/main.mjs` (modify)

```javascript
ipcMain.handle("content:recompose", async (_, payload) => {
  // POST /orgs/:orgId/contents/:contentId/recompose
  const response = await apiCall("POST", `/orgs/${orgId}/contents/${payload.contentId}/recompose`, {
    templateId: payload.templateId,
    overlayMain: payload.overlayMain,
    overlaySub: payload.overlaySub,
    imagePaths: payload.imagePaths,
  });
  return response;
});
```

---

## 7) Caption Editor

### 7.1 CaptionEditor component

File: `apps/desktop/src/components/scheduler/instagram/CaptionEditor.tsx` (new)

```typescript
type CaptionEditorProps = {
  caption: string;
  hashtags: string[];
  onChange: (caption: string) => void;
  onHashtagChange: (hashtags: string[]) => void;
};

const CaptionEditor = ({ caption, hashtags, onChange, onHashtagChange }: CaptionEditorProps) => {
  const charCount = caption.length;
  const INSTAGRAM_MAX = 2200;

  return (
    <div className="caption-editor">
      <label className="caption-label">Caption</label>
      <textarea
        className="caption-textarea"
        value={caption}
        onChange={(e) => onChange(e.target.value)}
        placeholder="인스타그램 캡션을 편집하세요..."
        rows={6}
      />
      <div className="caption-status-bar">
        <span className={charCount > INSTAGRAM_MAX ? "char-over" : ""}>
          {charCount.toLocaleString()}자 / {INSTAGRAM_MAX.toLocaleString()}자
        </span>
        {charCount > INSTAGRAM_MAX && (
          <span className="char-warning">글자수 초과</span>
        )}
      </div>
      <div className="hashtag-display">
        {hashtags.map((tag, i) => (
          <span key={i} className="hashtag-chip">#{tag}</span>
        ))}
      </div>
    </div>
  );
};
```

---

## 8) Action Bar

### 8.1 InstagramActionBar

File: `apps/desktop/src/components/scheduler/instagram/InstagramActionBar.tsx` (new)

```typescript
type InstagramActionBarProps = {
  imageUrl: string;
  caption: string;
  isDirty: boolean;
  isSaving: boolean;
  isRecomposing: boolean;
  localSaveStatus: "idle" | "saved" | "error";
  onDownloadImage: () => void;
  onCopyCaption: () => void;
  onSave: () => void;
  onRegenerate: () => void;
};

const InstagramActionBar = (props: InstagramActionBarProps) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const handleCopyCaption = async () => {
    await navigator.clipboard.writeText(props.caption);
    setCopyStatus("copied");
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  return (
    <div className="instagram-action-bar">
      <button type="button" onClick={props.onDownloadImage} disabled={props.isRecomposing}>
        이미지 다운로드
      </button>
      <button type="button" onClick={handleCopyCaption}>
        {copyStatus === "copied" ? "복사됨!" : "캡션 복사"}
      </button>
      <button
        type="button"
        className="primary"
        onClick={props.onSave}
        disabled={!props.isDirty || props.isSaving}
      >
        {props.isSaving ? "저장 중..." : "저장"}
      </button>
      <button type="button" onClick={props.onRegenerate}>
        재생성
      </button>

      {props.localSaveStatus === "saved" && (
        <span className="save-indicator">로컬 저장 완료</span>
      )}
    </div>
  );
};
```

### 8.2 Image download handler

```typescript
const handleDownloadImage = async () => {
  // Use Electron's download capability
  const result = await runtime.content.downloadImage({
    imageUrl: composedImageUrl,
    suggestedFileName: `instagram_${content.id}.png`,
  });
  // result.filePath contains the saved location
};
```

IPC handler in `main.mjs`:

```javascript
ipcMain.handle("content:download-image", async (_, payload) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: payload.suggestedFileName,
    filters: [{ name: "Images", extensions: ["png", "jpg"] }],
  });
  if (!filePath) return { ok: false, cancelled: true };

  const response = await fetch(payload.imageUrl);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  return { ok: true, filePath };
});
```

---

## 9) Chat Integration

### 9.1 Generation completion card (extends 7-1b pattern)

When Instagram content generation completes, chat shows:

```
┌───────────────────────────────────────┐
│ ✅ 인스타그램 게시물이 생성되었습니다.  │
│                                       │
│ ┌─────────────┐  봄나들이 행사 홍보    │
│ │  [Preview]  │  450자 캡션 | 1080x1080│
│ │  thumbnail  │  Claude로 생성         │
│ └─────────────┘                       │
│                                       │
│ [에디터에서 보기]  [캡션 복사]          │
└───────────────────────────────────────┘
```

File: `apps/desktop/src/components/chat/InstagramGenerationCard.tsx` (new)

The card includes a small thumbnail of the composed image from Supabase Storage URL.

---

## 10) Styling

File: `apps/desktop/src/styles/scheduler.css` (modify — add Instagram editor styles)

```css
/* Image Preview */
.image-preview-container {
  position: relative;
  width: 100%;
  max-width: 540px;  /* 1080/2 for retina display */
  margin: 0 auto;
  border-radius: var(--radius-md);
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.image-preview-img {
  display: block;
  width: 100%;
  height: auto;
}

.image-preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 14px;
}

/* Overlay Text Editing */
.overlay-main-edit,
.overlay-sub-edit {
  position: absolute;
  cursor: pointer;
  text-align: center;
  border: 2px dashed transparent;
  transition: border-color 0.2s;
}

.overlay-main-edit:hover,
.overlay-sub-edit:hover {
  border-color: var(--accent-primary);
}

.overlay-main-edit.editing,
.overlay-sub-edit.editing {
  border-color: var(--accent-primary);
  background: rgba(255, 255, 255, 0.9);
  outline: none;
}

/* Template/Image Controls */
.template-image-controls {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  align-items: center;
}

.template-image-controls select {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
}

.image-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

/* Caption Editor */
.caption-textarea {
  width: 100%;
  min-height: 120px;
  padding: var(--space-sm);
  font-size: 14px;
  line-height: 1.6;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  resize: vertical;
}

.char-over { color: var(--color-error); font-weight: bold; }
.char-warning { color: var(--color-error); font-size: 12px; }

.hashtag-display {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: var(--space-xs);
}

.hashtag-chip {
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* Image Picker Modal */
.image-picker-modal {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-sm);
  margin: var(--space-md) 0;
}

.image-grid-item {
  cursor: pointer;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}

.image-grid-item:hover {
  border-color: var(--accent-primary);
}

.image-grid-item img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}

/* Instagram Action Bar */
.instagram-action-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--border-default);
  flex-wrap: wrap;
}
```

---

## 11) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/desktop/src/components/scheduler/ContentEditor.tsx` | Modify | Add instagram case to dispatcher |
| `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx` | Create | Main Instagram editor orchestrator |
| `apps/desktop/src/components/scheduler/instagram/ImagePreview.tsx` | Create | Composed image display |
| `apps/desktop/src/components/scheduler/instagram/OverlayTextEdit.tsx` | Create | Inline text editing on image |
| `apps/desktop/src/components/scheduler/instagram/TemplateImageControls.tsx` | Create | Template selector + image swap |
| `apps/desktop/src/components/scheduler/instagram/ImagePickerModal.tsx` | Create | Activity folder image picker |
| `apps/desktop/src/components/scheduler/instagram/CaptionEditor.tsx` | Create | Caption textarea + char count |
| `apps/desktop/src/components/scheduler/instagram/InstagramActionBar.tsx` | Create | Download + copy + save + regen |
| `apps/desktop/src/components/chat/InstagramGenerationCard.tsx` | Create | Chat completion card with thumbnail |
| `apps/desktop/src/styles/scheduler.css` | Modify | Instagram editor styles |
| `apps/desktop/src/global.d.ts` | Modify | Add recompose + downloadImage types |
| `apps/desktop/electron/main.mjs` | Modify | content:recompose + content:download-image IPC |
| `apps/desktop/electron/preload.mjs` | Modify | Expose new methods |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |
| `apps/api/src/routes/sessions.ts` | Modify | Add recompose route |
| `apps/api/src/orchestrator/service.ts` | Modify | Add `recomposeContent()` |

---

## 12) Acceptance Criteria

1. Instagram content opens in visual editor with composed image preview.
2. Clicking overlay text on the image activates inline editing with character limit.
3. Changing overlay text triggers debounced re-compose → preview refreshes.
4. Template selector changes layout → re-compose → preview updates.
5. Image replacement via picker modal → re-compose → preview updates.
6. Caption textarea edits separately from overlay text with character count.
7. Download button saves composed PNG via Electron save dialog.
8. Copy caption button copies caption + hashtags to clipboard.
9. Save button persists all changes (caption, overlay, template, image) to DB + local file.
10. Re-compose shows loading overlay on image during processing.
11. Chat completion card shows thumbnail preview of composed image.
12. `pnpm --filter desktop type-check` passes.

---

## 13) Verification Plan

1. `pnpm --filter desktop type-check` — pass
2. `pnpm type-check` — pass (workspace-wide)
3. Manual: open Instagram content in editor → verify composed image displays correctly
4. Manual: click overlay text → edit → verify re-compose triggers and preview updates
5. Manual: change template via dropdown → verify re-compose with new layout
6. Manual: swap image via picker → verify re-compose with new photo
7. Manual: edit caption → verify character count updates, does not trigger image re-compose
8. Manual: download image → verify Electron save dialog → file saved correctly
9. Manual: copy caption → verify clipboard content
10. Manual: save → verify DB update + local file written
11. Manual: verify chat completion card shows image thumbnail

---

## 14) Decisions

**Why server-side re-compose instead of client-side canvas:**
FFmpeg is already established as the media engine (7-2a). Keeping composition server-side ensures consistent output across platforms. Client-side canvas (Fabric.js) would duplicate rendering logic and diverge from the backend output. Re-compose latency (~2-3 seconds for a single image) is acceptable with a loading overlay.

**Why inline text editing over a properties panel:**
Directly clicking text on the image to edit is more intuitive than a separate panel with text fields. This follows the "preview IS the editor" principle established in 7-1b discussion.

**Why debounced re-compose (800ms):**
Immediate re-compose on every keystroke would be too expensive. 800ms debounce balances responsiveness with server load. The user sees their text change immediately in the overlay element (optimistic UI), then the composed image refreshes after the debounce.

**Why separate caption from overlay text:**
Instagram caption (posted as text below the image) and overlay text (rendered on the image) serve different purposes and have different constraints. Editing them independently avoids coupling.
