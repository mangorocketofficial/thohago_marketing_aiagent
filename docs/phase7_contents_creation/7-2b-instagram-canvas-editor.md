# Phase 7-2b: Instagram Content — Canvas Editor + Template Rendering

- Date: 2026-03-05
- Status: Planning
- Scope: Visual editor for Instagram content (image preview, text editing, template switching, image replacement), integrated into scheduler ContentEditor dispatcher
- Depends on: Phase 7-2a (Sharp image composition, template system, Supabase Storage private bucket), Phase 7-1b (ContentEditor dispatcher pattern)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

Phase 7-2a generates composed Instagram images on the backend (via Sharp), but the user has no way to:
1. Preview the composed image in the app.
2. Edit text overlays directly on the image.
3. Switch templates after generation.
4. Replace the user photo without full regeneration.
5. Make fine adjustments (text position, font size, color) before finalizing.

The current `ContentEditor` was refactored in 7-1b into a channel-aware dispatcher. Instagram needs a visual canvas editor, not a text editor.

---

## 2) Goals

1. **Image preview**: Display the composed Instagram image in the editor area via signed URL.
2. **Inline text editing**: Click overlay text on the image to edit it directly, with template-aware positioning.
3. **Template switching**: Change template and re-compose without regenerating caption/images.
4. **Image replacement**: Swap user photos (single or multi-slot collage) from activity folder without regenerating text.
5. **Caption + hashtag editing**: Edit caption text and manage hashtags (add/remove) in a section below the image.
6. **Re-compose on edit**: When overlay text, template, or image changes → trigger server-side Sharp re-compose → refresh preview.
7. **Regenerate**: Full LLM re-generation with confirmation dialog and scope selection.
8. **Action bar**: Download image / Copy caption / Save / Regenerate.

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
│  Template: [중앙 이미지 ▼]                           │
│  Images: [event.jpg ✕] [spring.jpg ✕] [+ 추가]      │
├──────────────────────────────────────────────────────┤
│  Caption                                             │
│  ┌────────────────────────────────────────────────┐  │
│  │ 봄 나들이 행사에 함께해요! 🌸                     │  │
│  │ ...                                            │  │
│  └────────────────────────────────────────────────┘  │
│  450자 / 2,200자 max                                 │
│                                                      │
│  Hashtags                                            │
│  [#봄나들이 ✕] [#행사 ✕] [#함께해요 ✕] [+ 추가]      │
├──────────────────────────────────────────────────────┤
│  [이미지 다운로드]  [캡션 복사]  [저장]  [재생성 ▼]    │
└──────────────────────────────────────────────────────┘
```

### 3.3 Component hierarchy

```
InstagramContentEditor
  ├── EditorHeader                    (shared with BlogContentEditor)
  ├── ImagePreview                    (composed image display + overlay positioning)
  │   ├── OverlayTextEdit (main)     (inline text editing, template-coordinate aware)
  │   └── OverlayTextEdit (sub)
  ├── TemplateImageControls           (template selector + multi-image management)
  ├── CaptionEditor                   (textarea for caption)
  │   ├── CharCountBar
  │   └── HashtagEditor              (chip-based add/remove)
  ├── RegenerateDialog               (confirmation + scope selection)
  └── InstagramActionBar              (download + copy + save + regenerate)
```

---

## 4) Image Preview Component

### 4.1 ImagePreview

File: `apps/desktop/src/components/scheduler/instagram/ImagePreview.tsx` (new)

Displays the composed image from Supabase Storage signed URL. Overlay text edit zones are positioned using template coordinates scaled to display size.

```typescript
type TemplateTextPosition = {
  x: number;       // template pixel coordinate (e.g., 60)
  y: number;       // template pixel coordinate (e.g., 790)
  maxWidth: number; // template pixel width (e.g., 960)
  fontSize: number; // template font size (e.g., 52)
  align: "center" | "left" | "right";
};

type ImagePreviewProps = {
  imageUrl: string;                // Supabase Storage signed URL
  width: number;                   // template width (1080)
  height: number;                  // template height (1080)
  overlayMain: string;
  overlaySub: string;
  mainTextPosition: TemplateTextPosition;
  subTextPosition: TemplateTextPosition | null;
  isRecomposing: boolean;
  onEditOverlayMain: (text: string) => void;
  onEditOverlaySub: (text: string) => void;
};

const ImagePreview = ({
  imageUrl, isRecomposing, width, height,
  mainTextPosition, subTextPosition,
  ...props
}: ImagePreviewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);

  // Scale 1080px template to fit editor container width
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const containerWidth = entries[0]?.contentRect.width ?? 540;
      setDisplayScale(containerWidth / width);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [width]);

  /**
   * Convert template pixel coordinates to CSS position on scaled preview.
   */
  const toDisplayStyle = (pos: TemplateTextPosition): React.CSSProperties => ({
    position: "absolute",
    top: pos.y * displayScale,
    left: pos.x * displayScale,
    width: pos.maxWidth * displayScale,
    fontSize: pos.fontSize * displayScale,
    textAlign: pos.align,
  });

  return (
    <div className="image-preview-container" ref={containerRef}>
      <img
        src={imageUrl}
        alt="Instagram post preview"
        className="image-preview-img"
        style={{ width: "100%", aspectRatio: `${width}/${height}` }}
      />

      {/* Overlay text edit zones — positioned from template coordinates */}
      <OverlayTextEdit
        value={props.overlayMain}
        onChange={props.onEditOverlayMain}
        style={toDisplayStyle(mainTextPosition)}
        maxLength={15}
        placeholder="메인 텍스트"
      />
      {subTextPosition && (
        <OverlayTextEdit
          value={props.overlaySub}
          onChange={props.onEditOverlaySub}
          style={toDisplayStyle(subTextPosition)}
          maxLength={25}
          placeholder="서브 텍스트"
        />
      )}

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

Inline text editing directly on the image preview. Accepts `style` prop for template-coordinate positioning.

```typescript
type OverlayTextEditProps = {
  value: string;
  onChange: (text: string) => void;
  style: React.CSSProperties;
  maxLength: number;
  placeholder: string;
};

const OverlayTextEdit = ({ value, onChange, style, maxLength, placeholder }: OverlayTextEditProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when parent value changes (e.g., after re-compose)
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

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
        className="overlay-text-edit editing"
        style={style}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
      />
    );
  }

  return (
    <span
      className="overlay-text-edit display"
      style={style}
      onClick={handleClick}
      title="클릭하여 수정"
    >
      {value || placeholder}
    </span>
  );
};
```

### 4.3 Template coordinate → display coordinate mapping

The `InstagramContentEditor` parent extracts text positions from the loaded template definition and passes them to `ImagePreview`:

```typescript
// In InstagramContentEditor
const template = templates.find(t => t.id === currentTemplateId);

const mainTextPosition: TemplateTextPosition = {
  x: template.layers.mainText.x,
  y: template.layers.mainText.y,
  maxWidth: template.layers.mainText.maxWidth,
  fontSize: template.layers.mainText.fontSize,
  align: template.layers.mainText.align,
};

const subTextPosition: TemplateTextPosition | null = template.layers.subText
  ? {
      x: template.layers.subText.x,
      y: template.layers.subText.y,
      maxWidth: template.layers.subText.maxWidth,
      fontSize: template.layers.subText.fontSize,
      align: template.layers.subText.align,
    }
  : null;
```

This ensures overlay edit zones always match the actual text positions in the composed image, regardless of which template is selected.

---

## 5) Template & Image Controls

### 5.1 TemplateImageControls

File: `apps/desktop/src/components/scheduler/instagram/TemplateImageControls.tsx` (new)

Supports multi-image management for collage templates. Shows how many image slots the current template requires.

```typescript
type TemplateImageControlsProps = {
  currentTemplateId: string;
  currentImageFileIds: string[];           // array for multi-image (collage)
  currentImageNames: string[];             // display names parallel to fileIds
  requiredImageCount: number;              // from template.layers.userImageAreas?.length ?? 0
  availableTemplates: Array<{ id: string; nameKo: string; description: string }>;
  onChangeTemplate: (templateId: string) => void;
  onAddImage: (slotIndex?: number) => void;     // opens image picker, optional slot index
  onRemoveImage: (slotIndex: number) => void;
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
        <label>
          이미지
          {props.requiredImageCount > 0 && (
            <span className="slot-count">
              ({props.currentImageFileIds.length}/{props.requiredImageCount})
            </span>
          )}
        </label>
        <div className="image-slot-list">
          {props.currentImageNames.map((name, i) => (
            <span key={i} className="image-tag">
              {name}
              <button
                type="button"
                className="image-tag-remove"
                onClick={() => props.onRemoveImage(i)}
                aria-label={`${name} 제거`}
              >
                ✕
              </button>
            </span>
          ))}
          {props.currentImageFileIds.length < props.requiredImageCount && (
            <button
              type="button"
              className="image-add-btn"
              onClick={() => props.onAddImage(props.currentImageFileIds.length)}
            >
              + 추가
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

### 5.2 Image picker modal

File: `apps/desktop/src/components/scheduler/instagram/ImagePickerModal.tsx` (new)

Shows activity folder images in a grid. Thumbnails are loaded via IPC to avoid `file://` protocol security issues in Electron's renderer process.

```typescript
type ActivityImage = {
  fileId: string;
  fileName: string;
  thumbnailDataUrl: string;  // base64 data URL loaded via IPC
};

type ImagePickerModalProps = {
  images: ActivityImage[];
  isLoading: boolean;
  targetSlotIndex: number | null;   // which slot this selection fills (for collage)
  onSelect: (fileId: string, slotIndex: number | null) => void;
  onClose: () => void;
};

const ImagePickerModal = ({ images, isLoading, targetSlotIndex, onSelect, onClose }: ImagePickerModalProps) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="image-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          이미지 선택
          {targetSlotIndex !== null && <span className="slot-label"> (슬롯 {targetSlotIndex + 1})</span>}
        </h3>

        {isLoading ? (
          <div className="image-picker-loading">이미지 불러오는 중...</div>
        ) : images.length === 0 ? (
          <div className="image-picker-empty">활동 폴더에 이미지가 없습니다.</div>
        ) : (
          <div className="image-grid">
            {images.map((img) => (
              <div
                key={img.fileId}
                className="image-grid-item"
                onClick={() => { onSelect(img.fileId, targetSlotIndex); onClose(); }}
              >
                <img src={img.thumbnailDataUrl} alt={img.fileName} />
                <span>{img.fileName}</span>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={onClose}>취소</button>
      </div>
    </div>
  );
};
```

### 5.3 Image thumbnail IPC

File: `apps/desktop/electron/main.mjs` (modify)

Instead of exposing `file://` URLs directly, the main process generates thumbnails and returns base64 data URLs.
Security boundary rule: renderer does not control `orgId`; main process always uses authenticated `runtimeState.orgId`.

```javascript
ipcMain.handle("content:load-activity-thumbnails", async (_, payload) => {
  const orgId = runtimeState.orgId; // trust boundary: do not accept orgId from renderer
  const activityFolder = typeof payload?.activityFolder === "string" ? payload.activityFolder.trim() : "";
  if (!activityFolder) {
    throw new Error("activityFolder is required.");
  }

  // 1. Fetch image list from API
  const { images } = await apiCall(
    "GET",
    `/orgs/${orgId}/activity-images?activity_folder=${encodeURIComponent(activityFolder)}`
  );

  // 2. Generate thumbnails via Sharp (or read + resize in main process)
  const results = await Promise.all(
    images.map(async (img) => {
      try {
        const absolutePath = resolveActivityPath(orgId, img.relativePath);
        const thumbBuffer = await sharp(absolutePath)
          .resize(200, 200, { fit: "cover" })
          .jpeg({ quality: 70 })
          .toBuffer();
        return {
          fileId: img.fileId,
          fileName: img.fileName,
          thumbnailDataUrl: `data:image/jpeg;base64,${thumbBuffer.toString("base64")}`,
        };
      } catch {
        return null; // skip unreadable files
      }
    })
  );

  return results.filter(Boolean);
});
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
      imageFileIds
    })
  → API: POST /orgs/:orgId/contents/:contentId/recompose
    → Sharp re-compose with new parameters
    → Upload new image to Supabase Storage private bucket (upsert)
    → Update contents.metadata
    → Create signed URL for response
  → Response: { ok, signedImageUrl, expiresAt, requestId }
  → ImagePreview refreshes with new signed URL
```

### 6.1 Recompose API

Route: `POST /orgs/:orgId/contents/:contentId/recompose`

```typescript
// Request
{
  templateId: string;
  overlayMain: string;
  overlaySub: string;
  imageFileIds?: string[];  // only if image changed; resolved to paths server-side
  clientRequestId?: string; // opaque id for race-safe reconciliation
}

// Response
{
  ok: boolean;
  signedImageUrl: string;   // short-lived signed URL (30 min)
  expiresAt: string;        // ISO timestamp
  requestId: string;        // echoes clientRequestId (or server-generated id)
  updated_at: string;
}
```

File: `apps/api/src/routes/sessions.ts` (modify — add route)
File: `apps/api/src/orchestrator/service.ts` (modify — add `recomposeContent()`)

The `recomposeContent()` service method:
1. Loads content metadata from DB.
2. Resolves `imageFileIds` to absolute paths via activity file index.
3. Validates image slot count against selected template (`requiredImageCount`).
4. Returns `422 invalid_payload` when `providedImageCount !== requiredImageCount` for collage templates.
5. Calls `composeInstagramImage()` from 7-2a with new parameters.
6. Uploads composed buffer to private bucket (upsert overwrites previous).
7. Updates `contents.metadata` with new `composed_image_storage`, `template_id`, overlay texts.
8. Returns signed URL for the new image.

### 6.2 Recompose race-condition guard (latest-wins)

Re-compose requests are asynchronous and can return out of order. Renderer applies only the latest response.

```typescript
const requestSeqRef = useRef(0);

const requestRecompose = async (input: RecomposeInput) => {
  const seq = requestSeqRef.current + 1;
  requestSeqRef.current = seq;
  setIsRecomposing(true);

  const result = await runtime.content.recompose({
    ...input,
    clientRequestId: `${contentId}:${seq}`,
  });

  // Ignore stale responses that finished late.
  if (seq < requestSeqRef.current) {
    return;
  }

  setIsRecomposing(false);
  if (!result.ok) {
    setNotice(result.message ?? "Failed to re-compose image.");
    return;
  }

  setImageUrl(result.signedImageUrl);
  setSignedUrlExpiresAt(result.expiresAt);
};
```

IPC/API should pass through `clientRequestId` as `requestId` to support tracing and debugging.

### 6.3 IPC handler

File: `apps/desktop/electron/main.mjs` (modify)

```javascript
ipcMain.handle("content:recompose", async (_, payload) => {
  const response = await apiCall("POST", `/orgs/${orgId}/contents/${payload.contentId}/recompose`, {
    templateId: payload.templateId,
    overlayMain: payload.overlayMain,
    overlaySub: payload.overlaySub,
    imageFileIds: payload.imageFileIds,
    clientRequestId: payload.clientRequestId,
  });
  return response;
});
```

### 6.4 Signed URL refresh

Since signed URLs expire (30 min), the editor needs a refresh mechanism:

```typescript
// In InstagramContentEditor — useEffect for URL refresh
const SIGNED_URL_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

useEffect(() => {
  if (!signedUrlExpiresAt) return;
  const expiresMs = new Date(signedUrlExpiresAt).getTime();
  const refreshAt = expiresMs - SIGNED_URL_BUFFER_MS - Date.now();
  if (refreshAt <= 0) {
    refreshSignedUrl(); // already near expiry
    return;
  }
  const timer = setTimeout(refreshSignedUrl, refreshAt);
  return () => clearTimeout(timer);
}, [signedUrlExpiresAt]);

const refreshSignedUrl = async () => {
  const result = await runtime.content.getSignedUrl({ contentId });
  setImageUrl(result.signedImageUrl);
  setSignedUrlExpiresAt(result.expiresAt);
};
```

---

## 7) Caption & Hashtag Editor

### 7.1 CaptionEditor component

File: `apps/desktop/src/components/scheduler/instagram/CaptionEditor.tsx` (new)

```typescript
type CaptionEditorProps = {
  caption: string;
  hashtags: string[];
  onChange: (caption: string) => void;
  onHashtagsChange: (hashtags: string[]) => void;
};

const CaptionEditor = ({ caption, hashtags, onChange, onHashtagsChange }: CaptionEditorProps) => {
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

      <HashtagEditor hashtags={hashtags} onChange={onHashtagsChange} />
    </div>
  );
};
```

### 7.2 HashtagEditor component

File: `apps/desktop/src/components/scheduler/instagram/HashtagEditor.tsx` (new)

Chip-based hashtag management with add/remove:

```typescript
type HashtagEditorProps = {
  hashtags: string[];
  onChange: (hashtags: string[]) => void;
};

const HashtagEditor = ({ hashtags, onChange }: HashtagEditorProps) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const tag = inputValue.trim().replace(/^#/, "");
    if (!tag || hashtags.includes(tag)) return;
    onChange([...hashtags, tag]);
    setInputValue("");
    inputRef.current?.focus();
  };

  const handleRemove = (index: number) => {
    onChange(hashtags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleAdd();
    }
    // Backspace on empty input removes last tag
    if (e.key === "Backspace" && inputValue === "" && hashtags.length > 0) {
      handleRemove(hashtags.length - 1);
    }
  };

  return (
    <div className="hashtag-editor">
      <label className="hashtag-label">Hashtags ({hashtags.length})</label>
      <div className="hashtag-input-area">
        {hashtags.map((tag, i) => (
          <span key={`${tag}-${i}`} className="hashtag-chip">
            #{tag}
            <button
              type="button"
              className="hashtag-remove"
              onClick={() => handleRemove(i)}
              aria-label={`#${tag} 삭제`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="hashtag-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleAdd}
          placeholder={hashtags.length === 0 ? "해시태그 입력 (Enter로 추가)" : ""}
          size={Math.max(inputValue.length + 2, 8)}
        />
      </div>
    </div>
  );
};
```

---

## 8) Regenerate Dialog

### 8.1 RegenerateDialog component

File: `apps/desktop/src/components/scheduler/instagram/RegenerateDialog.tsx` (new)

Confirmation dialog with scope selection — user chooses what to regenerate:

```typescript
type RegenerateScope = "all" | "caption_only" | "image_only";

type RegenerateDialogProps = {
  isOpen: boolean;
  onConfirm: (scope: RegenerateScope) => void;
  onCancel: () => void;
};

const RegenerateDialog = ({ isOpen, onConfirm, onCancel }: RegenerateDialogProps) => {
  const [scope, setScope] = useState<RegenerateScope>("all");

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="regenerate-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>콘텐츠 재생성</h3>
        <p>현재 편집 내용이 사라집니다. 재생성 범위를 선택하세요.</p>

        <div className="regenerate-options">
          <label>
            <input
              type="radio"
              name="scope"
              value="all"
              checked={scope === "all"}
              onChange={() => setScope("all")}
            />
            전체 재생성 (캡션 + 이미지 선택 + 합성)
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="caption_only"
              checked={scope === "caption_only"}
              onChange={() => setScope("caption_only")}
            />
            캡션만 재생성 (현재 이미지 유지)
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="image_only"
              checked={scope === "image_only"}
              onChange={() => setScope("image_only")}
            />
            이미지만 재선택 + 합성 (현재 캡션 유지)
          </label>
        </div>

        <div className="regenerate-actions">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" onClick={() => onConfirm(scope)}>
            재생성
          </button>
        </div>
      </div>
    </div>
  );
};
```

### 8.2 Regenerate flow

```
User clicks "재생성" button
  → RegenerateDialog opens with scope selection
  → User selects scope and confirms

[scope: "all"]
  → API: POST /orgs/:orgId/contents/:contentId/regenerate
    → Re-run full pipeline: LLM caption → image selection → Sharp compose
    → Overwrite content in DB + Storage
  → Editor refreshes all fields

[scope: "caption_only"]
  → API: POST /orgs/:orgId/contents/:contentId/regenerate?scope=caption_only
    → Re-run LLM caption only → update DB body + metadata
    → Existing composed image kept (or re-compose if overlay text changed)
  → Editor refreshes caption + overlay text

[scope: "image_only"]
  → API: POST /orgs/:orgId/contents/:contentId/regenerate?scope=image_only
    → Re-run image selection → Sharp re-compose with existing caption
    → Update DB metadata + Storage image
  → Editor refreshes image preview
```

---

## 9) Action Bar

### 9.1 InstagramActionBar

File: `apps/desktop/src/components/scheduler/instagram/InstagramActionBar.tsx` (new)

```typescript
type InstagramActionBarProps = {
  imageUrl: string;
  caption: string;
  hashtags: string[];
  isDirty: boolean;
  isSaving: boolean;
  isRecomposing: boolean;
  localSaveStatus: "idle" | "saved" | "error";
  onDownloadImage: () => void;
  onSave: () => void;
  onRegenerate: () => void;
};

const InstagramActionBar = (props: InstagramActionBarProps) => {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const handleCopyCaption = async () => {
    const fullCaption = props.hashtags.length > 0
      ? `${props.caption}\n\n${props.hashtags.map(t => `#${t}`).join(" ")}`
      : props.caption;
    await navigator.clipboard.writeText(fullCaption);
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

### 9.2 Image download handler

```typescript
const handleDownloadImage = async () => {
  const result = await runtime.content.downloadImage({
    contentId: content.id,
    suggestedFileName: `instagram_${content.id}.png`,
  });
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

  // Download from signed URL (obtained via API)
  const { signedImageUrl } = await apiCall(
    "GET",
    `/orgs/${orgId}/contents/${payload.contentId}/signed-url`
  );
  const response = await fetch(signedImageUrl);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(filePath, Buffer.from(buffer));
  return { ok: true, filePath };
});
```

---

## 10) Chat Integration

### 10.1 Generation completion card (extends 7-1b pattern)

When Instagram content generation completes, chat shows:

```
┌───────────────────────────────────────┐
│ 인스타그램 게시물이 생성되었습니다.     │
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

The card includes a small thumbnail of the composed image loaded via signed URL from the generation response.

---

## 11) Styling

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

/* Overlay Text Editing — positioned via inline style from template coords */
.overlay-text-edit {
  position: absolute;
  cursor: pointer;
  border: 2px dashed transparent;
  transition: border-color 0.2s;
  padding: 2px 4px;
  box-sizing: border-box;
  background: transparent;
  color: transparent;  /* text invisible — the composed image shows the real text */
}

.overlay-text-edit:hover {
  border-color: var(--accent-primary);
  background: rgba(255, 255, 255, 0.15);
}

.overlay-text-edit.editing {
  border-color: var(--accent-primary);
  background: rgba(255, 255, 255, 0.9);
  color: var(--text-primary);
  outline: none;
}

/* Template/Image Controls */
.template-image-controls {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  align-items: flex-start;
  flex-wrap: wrap;
}

.template-image-controls select {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
}

.image-slot-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.image-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.image-tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: var(--text-secondary);
  padding: 0 2px;
}

.image-tag-remove:hover {
  color: var(--color-error);
}

.image-add-btn {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.slot-count {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 4px;
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

/* Hashtag Editor */
.hashtag-editor {
  margin-top: var(--space-sm);
}

.hashtag-input-area {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: var(--space-xs);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  min-height: 36px;
  align-items: center;
  cursor: text;
}

.hashtag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.hashtag-remove {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 10px;
  color: var(--text-secondary);
  padding: 0 2px;
}

.hashtag-remove:hover {
  color: var(--color-error);
}

.hashtag-input {
  border: none;
  outline: none;
  font-size: 12px;
  background: transparent;
  min-width: 60px;
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

.image-picker-loading,
.image-picker-empty {
  padding: var(--space-lg);
  text-align: center;
  color: var(--text-secondary);
}

/* Regenerate Dialog */
.regenerate-dialog {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  max-width: 400px;
}

.regenerate-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: var(--space-md) 0;
}

.regenerate-options label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  cursor: pointer;
  font-size: 14px;
}

.regenerate-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-md);
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

## 12) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/desktop/src/components/scheduler/ContentEditor.tsx` | Modify | Add instagram case to dispatcher |
| `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx` | Create | Main Instagram editor orchestrator |
| `apps/desktop/src/components/scheduler/instagram/ImagePreview.tsx` | Create | Composed image display with template-coordinate overlay zones |
| `apps/desktop/src/components/scheduler/instagram/OverlayTextEdit.tsx` | Create | Inline text editing on image (style-prop positioned) |
| `apps/desktop/src/components/scheduler/instagram/TemplateImageControls.tsx` | Create | Template selector + multi-image slot management |
| `apps/desktop/src/components/scheduler/instagram/ImagePickerModal.tsx` | Create | Activity folder image picker (IPC thumbnails) |
| `apps/desktop/src/components/scheduler/instagram/CaptionEditor.tsx` | Create | Caption textarea + char count |
| `apps/desktop/src/components/scheduler/instagram/HashtagEditor.tsx` | Create | Chip-based hashtag add/remove/edit |
| `apps/desktop/src/components/scheduler/instagram/RegenerateDialog.tsx` | Create | Regeneration scope selection + confirmation |
| `apps/desktop/src/components/scheduler/instagram/InstagramActionBar.tsx` | Create | Download + copy (with hashtags) + save + regen |
| `apps/desktop/src/components/chat/InstagramGenerationCard.tsx` | Create | Chat completion card with thumbnail |
| `apps/desktop/src/styles/scheduler.css` | Modify | Instagram editor styles |
| `apps/desktop/src/global.d.ts` | Modify | Add recompose, downloadImage, loadThumbnails, getSignedUrl types |
| `apps/desktop/electron/main.mjs` | Modify | content:recompose, content:download-image, content:load-activity-thumbnails, content:get-signed-url IPC |
| `apps/desktop/electron/preload.mjs` | Modify | Expose new methods |
| `apps/desktop/electron/preload.cjs` | Modify | CJS bridge |
| `apps/api/src/routes/sessions.ts` | Modify | Add recompose + regenerate + signed-url routes |
| `apps/api/src/orchestrator/service.ts` | Modify | Add `recomposeContent()`, `regenerateContent()` |

---

## 13) Acceptance Criteria

1. Instagram content opens in visual editor with composed image preview via signed URL.
2. Overlay text edit zones are positioned correctly per template coordinates (scaled to display size).
3. Clicking overlay text activates inline editing with character limit (15 main / 25 sub).
4. Changing overlay text triggers debounced re-compose → preview refreshes with new signed URL.
5. Template selector changes layout → re-compose → preview updates, overlay positions adjust.
6. Multi-image management: add/remove/replace individual image slots for collage templates.
7. Image replacement via picker modal (IPC thumbnails, not `file://`) → re-compose → preview updates.
8. Caption textarea edits separately from overlay text with character count (2,200 max).
9. Hashtag editor supports add (Enter/Space), remove (✕/Backspace), and displays count.
10. Copy caption button includes caption text + hashtag line in clipboard.
11. Download button saves composed PNG via Electron save dialog using signed URL.
12. Regenerate button opens dialog with scope selection (all / caption only / image only).
13. Save button persists all changes (caption, hashtags, overlay, template, images) to DB + local file.
14. Re-compose shows loading overlay on image during processing.
15. Re-compose latest-wins guard ignores stale out-of-order responses.
16. API returns `422 invalid_payload` when collage image slot count is invalid.
17. Signed URL auto-refreshes before expiry (5 min buffer).
18. Chat completion card shows thumbnail preview of composed image.
19. `pnpm --filter desktop type-check` passes.

---

## 14) Verification Plan

1. `pnpm --filter desktop type-check` — pass
2. `pnpm type-check` — pass (workspace-wide)
3. Manual: open Instagram content in editor → verify composed image displays via signed URL
4. Manual: click overlay text → verify edit zone aligns with actual text position on image
5. Manual: edit overlay text → verify re-compose triggers and preview updates
6. Manual: change template via dropdown → verify re-compose + overlay zone repositioning
7. Manual: swap image via picker (verify thumbnails load via IPC, not file://) → verify re-compose
8. Manual: test collage template → add/remove individual image slots → verify re-compose
9. Manual: edit caption → verify character count updates, does not trigger image re-compose
10. Manual: add/remove hashtags → verify chip UI, Enter/Space/Backspace behavior
11. Manual: copy caption → verify clipboard contains caption + hashtag line
12. Manual: download image → verify Electron save dialog → file saved correctly
13. Manual: click regenerate → verify dialog opens with scope options → confirm → verify result
14. Manual: rapid overlay edits (3+ requests) → verify stale response does not overwrite latest preview
15. Manual: collage template with invalid image count → verify API 422 + editor error notice
16. Manual: save → verify DB update + local file written
17. Manual: wait for signed URL near-expiry → verify auto-refresh
18. Manual: verify chat completion card shows image thumbnail

---

## 15) Decisions

**Why server-side re-compose instead of client-side canvas:**
Sharp is established as the image engine in 7-2a. Keeping composition server-side ensures the preview exactly matches the final output. Client-side canvas (Fabric.js) would duplicate rendering logic and risk visual divergence. Sharp re-compose latency (~50-100ms server + network) is acceptable with an optimistic UI overlay.

**Why template-coordinate positioning for overlay edits:**
Overlay edit zones must match the actual text position in the composed image. Using template's `mainText.x/y/maxWidth/fontSize` scaled by `displayScale` ensures pixel-accurate alignment. Hardcoded CSS classes would break when switching templates with different layouts.

**Why IPC thumbnails instead of `file://` URLs:**
Electron's renderer process may block `file://` access depending on `webSecurity` settings. Loading thumbnails via IPC (main process reads + resizes via Sharp) is secure, consistent, and produces smaller payloads (200px JPEG vs full-resolution).

**Why inline text editing over a properties panel:**
Directly clicking text on the image to edit is more intuitive than a separate panel with text fields. This follows the "preview IS the editor" principle.

**Why debounced re-compose (800ms):**
Immediate re-compose on every keystroke would flood the API. 800ms debounce balances responsiveness with server load. The user sees their text change immediately in the overlay element (optimistic UI), then the composed image refreshes after the debounce.

**Why separate caption from overlay text:**
Instagram caption (posted as text below the image) and overlay text (rendered on the image) serve different purposes and have different constraints. Editing them independently avoids coupling.

**Why regeneration scope selection:**
Full regeneration is expensive (LLM call + image selection + composition). Often users only want to refresh the caption or swap images. Scope selection avoids unnecessary LLM calls and preserves user's manual edits where possible.

**Why signed URLs instead of public URLs:**
7-2a uses a private Supabase Storage bucket. Signed URLs (30 min TTL) prevent permanent exposure of org content. The editor auto-refreshes URLs before expiry.
