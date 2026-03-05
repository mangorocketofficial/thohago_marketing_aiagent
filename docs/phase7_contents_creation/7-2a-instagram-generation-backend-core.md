# Phase 7-2a: Instagram Content Generation — Backend Core

- Date: 2026-03-05
- Status: Planning
- Scope: `instagram_generation` skill, caption generation, ffmpeg media engine foundation, template system, image selection, content persistence
- Depends on: Phase 7-1a (shared LLM client, content save patterns), Phase 5-0 (skill router), Phase 5-2 (RAG context)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

Instagram content requires image + text (caption) generation — fundamentally different from blog text-only generation. The platform needs:

1. No skill exists for Instagram content creation.
2. No media composition engine exists for combining background images, user photos, and text overlays.
3. No template system exists for defining reusable visual layouts.
4. No mechanism for LLM-assisted image selection from the user's activity folder.
5. Campaign-scheduled and on-demand routes both need support, but on-demand requires a brief survey to gather topic/intent.

---

## 2) Goals

1. **Register `instagram_generation` skill** with intent matching for Instagram content requests.
2. **Generate captions** using RAG context + brand profile + channel-specific system prompt.
3. **Establish ffmpeg media engine** as the shared image/video composition foundation.
4. **Define template system** with 3-5 starter templates for 1080x1080 Instagram posts.
5. **Implement image selection** — LLM picks from user's indexed activity folder images, or user selects manually.
6. **Compose final image** — ffmpeg combines template background + user photo + text overlay → PNG output.
7. **Persist content** — `contents` table (image type) + `schedule_slots` link + local file save.
8. **Support two routes**: campaign-scheduled (auto) and on-demand (with mini survey).

---

## 3) Skill Architecture

### 3.1 Skill registration

File: `apps/api/src/orchestrator/skills/instagram-generation/index.ts` (new)

```typescript
export const createInstagramGenerationSkill = (): Skill => ({
  id: "instagram_generation",
  displayName: "Instagram Generation",
  version: "7.2.0",
  priority: 85, // below campaign_plan (100), below naverblog (90)
  handlesEvents: ["user_message"],
  matchIntent: matchInstagramIntent,
  execute: executeInstagramGeneration,
});
```

File: `apps/api/src/orchestrator/skills/router.ts` (modify)

```typescript
export const getSkillRegistry = (): SkillRegistry => {
  const registry = new SkillRegistry();
  registry.register(createCampaignPlanSkill());       // priority 100
  registry.register(createNaverBlogGenerationSkill()); // priority 90
  registry.register(createInstagramGenerationSkill()); // priority 85
  singletonRegistry = registry;
  return registry;
};
```

### 3.2 Intent matching

File: `apps/api/src/orchestrator/skills/instagram-generation/intent.ts` (new)

| Category | Keywords | Confidence |
|---|---|---|
| Strong phrases | "인스타 게시물 만들어", "인스타그램 콘텐츠 생성", "인스타 포스트 작성", "create instagram post" | 0.95 |
| Platform nouns | "인스타", "인스타그램", "instagram", "insta" | — |
| Content nouns | "게시물", "포스트", "피드", "카드뉴스", "post", "feed" | — |
| Action terms | "만들어", "생성", "작성", "올려", "create", "make", "generate" | — |
| Combined (platform + action) | — | 0.88 |
| Image-specific | "이미지", "사진", "디자인", "image", "photo" | boost +0.05 |
| Query terms (exclude) | "분석", "인사이트", "팔로워", "통계" | negative signal |

Disambiguation with `naverblog_generation`:
- If message contains "블로그" → route to naverblog.
- If message contains "인스타" → route to instagram.
- If ambiguous (just "글 써줘") → check `active_skill` first, then ask user which channel.

### 3.3 Generation routes

#### Route A: Campaign-scheduled generation

Trigger: Existing `schedule_slot` with `channel: "instagram"`.

Flow:
1. Load slot metadata → campaign plan topic/theme for this slot.
2. Skip survey — campaign plan already provides topic, audience, tone.
3. Generate caption → select image → compose → persist.

#### Route B: On-demand generation (with mini survey)

Trigger: User requests Instagram content without slot context.

Survey flow (2-3 turns max):

```
AI: "어떤 주제의 인스타 게시물을 만들까요?"
User: "봄 나들이 행사 홍보"
AI: "활동 폴더에서 사용할 이미지가 있나요?
     1) 폴더에서 AI가 자동 선택
     2) 직접 이미지 지정
     3) 이미지 없이 텍스트 디자인만"
User: "1번"
AI: "템플릿을 선택해주세요:
     1) 중앙 이미지 + 하단 텍스트
     2) 전면 이미지 + 오버레이 텍스트
     3) 콜라주 (2-4장)
     4) 자유형 (AI 추천)"
User: "4번"
→ Generation starts
```

Survey state tracked in session:

```typescript
type InstagramSurveyState = {
  phase: "topic" | "image_selection" | "template_selection" | "generating" | "complete";
  topic: string | null;
  imageMode: "auto" | "manual" | "text_only" | null;
  selectedImagePaths: string[];
  templateId: string | null;
  completed_at: string | null;
};
```

---

## 4) Caption Generation

### 4.1 Context assembly

Reuses shared patterns from 7-1a context assembly:

```typescript
type InstagramCaptionContext = {
  brandProfile: string;
  activityFiles: string;
  conversationMemory: string;
  campaignContext: string | null;
  topic: string;
  channel: "instagram";
  templateId: string;
};
```

### 4.2 System prompt

File: `apps/api/src/orchestrator/skills/instagram-generation/prompt.ts` (new)

```
[ROLE]
You are an Instagram content specialist for Korean organizations.

[BRAND_CONTEXT]
{brandProfile}

[TOPIC]
{topic}

[CAPTION_GUIDELINES]
- Write engaging Korean caption for Instagram feed post.
- Length: 150-500 characters (Instagram optimal engagement range).
- First line must hook the reader (question, surprising fact, or emotional appeal).
- Include line breaks for readability (every 2-3 sentences).
- End with a call-to-action (CTA).
- Add 15-20 relevant hashtags on a separate line.
- Tone: match brand voice from brand profile.
- Include emoji naturally (2-4 per caption, not excessive).

[IMAGE_OVERLAY_TEXT]
Also generate a short overlay text for the image:
- Main text: 1 line, max 15 characters (large, bold)
- Sub text: 1 line, max 25 characters (smaller)
These will be rendered on the image template.

[OUTPUT_FORMAT]
Return JSON:
{
  "caption": "...",
  "hashtags": ["태그1", "태그2", ...],
  "overlay_main": "...",
  "overlay_sub": "...",
  "suggested_image_keywords": ["keyword1", "keyword2"]
}
```

### 4.3 LLM invocation

Uses shared `llm-client.ts` (extracted in 7-1a):

```typescript
const result = await callWithFallback({
  orgId,
  prompt: assembledPrompt,
  maxTokens: 2048,
  primaryModel: "claude",
  fallbackModel: "gpt-4o-mini",
});
```

---

## 5) FFmpeg Media Engine Foundation

### 5.1 Module structure

```
apps/api/src/media/
  ├── ffmpeg-client.ts        ← FFmpeg wrapper (shared foundation)
  ├── image-composer.ts       ← Instagram image composition
  ├── templates/
  │   ├── schema.ts           ← Template JSON schema + types
  │   ├── registry.ts         ← Template loader + registry
  │   ├── presets/
  │   │   ├── center-image-bottom-text.json
  │   │   ├── fullscreen-overlay.json
  │   │   ├── collage-2x2.json
  │   │   ├── text-only-gradient.json
  │   │   └── split-image-text.json
  │   └── fonts/
  │       ├── Pretendard-Bold.otf
  │       ├── Pretendard-Regular.otf
  │       └── NotoSansKR-Bold.otf
  └── index.ts
```

### 5.2 FFmpeg client wrapper

File: `apps/api/src/media/ffmpeg-client.ts` (new)

```typescript
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// Use bundled ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegStatic);

export type CompositeLayer = {
  type: "image" | "text" | "shape";
  input?: string | Buffer;     // file path or buffer for image layers
  text?: string;               // for text layers
  font?: string;               // font file path
  fontSize?: number;
  fontColor?: string;
  position: { x: number | string; y: number | string };
  size?: { w: number; h: number };
  opacity?: number;
};

export type ComposeOptions = {
  width: number;
  height: number;
  background: string | Buffer;  // color hex or image path/buffer
  layers: CompositeLayer[];
  outputFormat: "png" | "jpg";
  quality?: number;             // 1-100 for jpg
};

/**
 * Compose multiple layers into a single image using ffmpeg.
 * Returns the composed image as a Buffer.
 */
export const composeImage = async (options: ComposeOptions): Promise<Buffer> => {
  // Build ffmpeg complex filter chain from layers
  const { filterChain, inputs } = buildFilterChain(options);

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add all input sources
    for (const input of inputs) {
      command.input(input);
    }

    command
      .complexFilter(filterChain)
      .outputOptions(["-frames:v", "1"])
      .format(options.outputFormat === "png" ? "image2" : "mjpeg")
      .on("error", reject)
      .pipe()
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks)));
  });
};

/**
 * Build ffmpeg complex filter chain from layer definitions.
 * Handles image overlay, text drawtext, and shape drawbox filters.
 */
const buildFilterChain = (options: ComposeOptions): { filterChain: string[]; inputs: string[] } => {
  const filters: string[] = [];
  const inputs: string[] = [];

  // Background layer
  if (typeof options.background === "string" && options.background.startsWith("#")) {
    // Solid color background
    filters.push(
      `color=c=${options.background}:s=${options.width}x${options.height}:d=1[bg]`
    );
  } else {
    // Image background
    inputs.push(typeof options.background === "string" ? options.background : "pipe:0");
    filters.push(`[0:v]scale=${options.width}:${options.height}[bg]`);
  }

  let lastLabel = "bg";

  for (const [index, layer] of options.layers.entries()) {
    const outLabel = `l${index}`;

    if (layer.type === "image" && layer.input) {
      const inputIndex = inputs.length;
      inputs.push(typeof layer.input === "string" ? layer.input : `pipe:${inputIndex}`);
      const scaleW = layer.size?.w ?? options.width;
      const scaleH = layer.size?.h ?? options.height;
      filters.push(`[${inputIndex}:v]scale=${scaleW}:${scaleH}[img${index}]`);
      filters.push(`[${lastLabel}][img${index}]overlay=${layer.position.x}:${layer.position.y}[${outLabel}]`);
      lastLabel = outLabel;
    }

    if (layer.type === "text" && layer.text) {
      const fontFile = layer.font ?? getDefaultFontPath();
      const escaped = escapeDrawtext(layer.text);
      filters.push(
        `[${lastLabel}]drawtext=text='${escaped}':fontfile='${fontFile}':fontsize=${layer.fontSize ?? 48}:fontcolor=${layer.fontColor ?? "white"}:x=${layer.position.x}:y=${layer.position.y}[${outLabel}]`
      );
      lastLabel = outLabel;
    }
  }

  return { filterChain: filters, inputs };
};

/**
 * Escape special characters for ffmpeg drawtext filter.
 * Korean text and special chars need proper escaping.
 */
const escapeDrawtext = (text: string): string => {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
};

const getDefaultFontPath = (): string => {
  return path.resolve(__dirname, "templates/fonts/Pretendard-Bold.otf");
};
```

### 5.3 Dependency installation

```bash
pnpm --filter @repo/api add fluent-ffmpeg ffmpeg-static
pnpm --filter @repo/api add -D @types/fluent-ffmpeg
```

`ffmpeg-static` bundles a platform-appropriate ffmpeg binary (no system install required for dev). For production Docker, include ffmpeg in the image.

---

## 6) Template System

### 6.1 Template schema

File: `apps/api/src/media/templates/schema.ts` (new)

```typescript
export type TemplateId =
  | "center-image-bottom-text"
  | "fullscreen-overlay"
  | "collage-2x2"
  | "text-only-gradient"
  | "split-image-text";

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  nameKo: string;
  description: string;
  width: number;           // always 1080 for Instagram
  height: number;          // 1080 (square), 1350 (portrait), 1080x608 (landscape)
  aspectRatio: "1:1" | "4:5" | "16:9";
  background: BackgroundDef;
  layers: TemplateLayers;
  thumbnail: string;       // path to preview thumbnail
};

export type BackgroundDef =
  | { type: "solid"; color: string }
  | { type: "gradient"; colors: [string, string]; direction: "vertical" | "horizontal" | "diagonal" }
  | { type: "image"; placeholder: "user_photo" };  // user image fills background

export type TemplateLayers = {
  userImageArea?: {
    x: number; y: number; w: number; h: number;
    fit: "cover" | "contain";
    borderRadius?: number;
  };
  mainText: {
    x: number | string; y: number | string;  // string for expressions like "(w-text_w)/2"
    maxWidth: number;
    fontSize: number;
    fontWeight: "regular" | "bold";
    fontColor: string;
    align: "center" | "left" | "right";
    lineSpacing?: number;
  };
  subText?: {
    x: number | string; y: number | string;
    maxWidth: number;
    fontSize: number;
    fontWeight: "regular" | "bold";
    fontColor: string;
    align: "center" | "left" | "right";
  };
  brandLogo?: {
    x: number; y: number; w: number; h: number;
    opacity: number;
  };
};
```

### 6.2 Starter templates (5 presets)

File: `apps/api/src/media/templates/presets/center-image-bottom-text.json`

```json
{
  "id": "center-image-bottom-text",
  "name": "Center Image + Bottom Text",
  "nameKo": "중앙 이미지 + 하단 텍스트",
  "description": "User photo centered with text bar at bottom",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "background": { "type": "solid", "color": "#FFFFFF" },
  "layers": {
    "userImageArea": {
      "x": 40, "y": 40, "w": 1000, "h": 700,
      "fit": "cover"
    },
    "mainText": {
      "x": "(w-text_w)/2", "y": 790,
      "maxWidth": 960,
      "fontSize": 52,
      "fontWeight": "bold",
      "fontColor": "#1A1A1A",
      "align": "center"
    },
    "subText": {
      "x": "(w-text_w)/2", "y": 860,
      "maxWidth": 960,
      "fontSize": 32,
      "fontWeight": "regular",
      "fontColor": "#666666",
      "align": "center"
    }
  }
}
```

Other presets follow the same schema:
- **fullscreen-overlay**: User photo fills entire frame, semi-transparent dark overlay, white text centered.
- **collage-2x2**: 4 image slots in a 2x2 grid with thin white borders, text at bottom.
- **text-only-gradient**: Gradient background (no user photo), large centered text.
- **split-image-text**: Left half image, right half solid color with text.

### 6.3 Template registry

File: `apps/api/src/media/templates/registry.ts` (new)

```typescript
import type { TemplateDefinition, TemplateId } from "./schema";

const templates = new Map<TemplateId, TemplateDefinition>();

export const loadPresetTemplates = (): void => {
  // Load all JSON presets from ./presets/ directory
  const presetFiles = fs.readdirSync(PRESETS_DIR).filter(f => f.endsWith(".json"));
  for (const file of presetFiles) {
    const def = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, file), "utf8")) as TemplateDefinition;
    templates.set(def.id, def);
  }
};

export const getTemplate = (id: TemplateId): TemplateDefinition | null => {
  return templates.get(id) ?? null;
};

export const getAllTemplates = (): TemplateDefinition[] => {
  return [...templates.values()];
};

export const getTemplateSummaries = (): Array<{ id: string; nameKo: string; description: string }> => {
  return getAllTemplates().map(t => ({ id: t.id, nameKo: t.nameKo, description: t.description }));
};
```

---

## 7) Image Selection

### 7.1 LLM-assisted selection (auto mode)

When user selects "AI가 자동 선택":

1. Load indexed image file entries from Phase 5-1 watcher data (file name, type, detected tags).
2. If image tags are not yet generated, use a lightweight tag pass:
   - Send file names + any EXIF metadata to LLM.
   - LLM returns relevance score for the topic.
3. Select top 1-4 images based on relevance (template determines how many images needed).

```typescript
type ImageSelectionResult = {
  mode: "auto" | "manual" | "text_only";
  selectedImages: Array<{
    filePath: string;
    fileName: string;
    relevanceScore: number;
    reason: string;
  }>;
};
```

LLM prompt for image selection:

```
[TASK]
Select the most relevant image(s) for an Instagram post about: "{topic}"

[AVAILABLE_IMAGES]
{imageList} // fileName, fileType, detectedAt, activityFolder

[SELECTION_CRITERIA]
- Relevance to topic
- Visual quality indicators (file size, resolution if available)
- Recency (prefer recent images)
- Template requires {N} image(s)

[OUTPUT]
Return JSON array of selected file names with relevance scores.
```

### 7.2 Manual selection (user selects)

When user selects "직접 이미지 지정":
- Chat shows available images from activity folder as a list.
- User specifies by name or number.
- Selected paths are stored in survey state.

### 7.3 Text-only mode

When user selects "이미지 없이 텍스트 디자인만":
- Force template to `text-only-gradient`.
- Skip image selection step.

---

## 8) Image Composition Pipeline

### 8.1 Composition flow

File: `apps/api/src/media/image-composer.ts` (new)

```typescript
export type ImageComposeInput = {
  templateId: TemplateId;
  userImages: string[];           // file paths
  overlayMainText: string;
  overlaySubText: string;
  brandLogoPath?: string;
  outputFormat: "png" | "jpg";
};

export type ImageComposeResult = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png" | "jpg";
  sizeBytes: number;
};

/**
 * Compose an Instagram image from template + user images + text overlays.
 */
export const composeInstagramImage = async (
  input: ImageComposeInput
): Promise<ImageComposeResult> => {
  const template = getTemplate(input.templateId);
  if (!template) throw new Error(`Template not found: ${input.templateId}`);

  // 1. Build background layer
  const background = resolveBackground(template.background, input.userImages);

  // 2. Build layer stack
  const layers: CompositeLayer[] = [];

  // User image layer (if template has userImageArea and images provided)
  if (template.layers.userImageArea && input.userImages.length > 0) {
    layers.push({
      type: "image",
      input: input.userImages[0],
      position: { x: template.layers.userImageArea.x, y: template.layers.userImageArea.y },
      size: { w: template.layers.userImageArea.w, h: template.layers.userImageArea.h },
    });
  }

  // Main text overlay
  layers.push({
    type: "text",
    text: input.overlayMainText,
    font: getFontPath(template.layers.mainText.fontWeight),
    fontSize: template.layers.mainText.fontSize,
    fontColor: template.layers.mainText.fontColor,
    position: { x: template.layers.mainText.x, y: template.layers.mainText.y },
  });

  // Sub text overlay (optional)
  if (template.layers.subText && input.overlaySubText) {
    layers.push({
      type: "text",
      text: input.overlaySubText,
      font: getFontPath(template.layers.subText.fontWeight),
      fontSize: template.layers.subText.fontSize,
      fontColor: template.layers.subText.fontColor,
      position: { x: template.layers.subText.x, y: template.layers.subText.y },
    });
  }

  // 3. Compose via ffmpeg
  const buffer = await composeImage({
    width: template.width,
    height: template.height,
    background,
    layers,
    outputFormat: input.outputFormat,
  });

  return {
    buffer,
    width: template.width,
    height: template.height,
    format: input.outputFormat,
    sizeBytes: buffer.length,
  };
};
```

### 8.2 User image preprocessing

Before composition, user images need preprocessing:

```typescript
const preprocessUserImage = async (imagePath: string, targetArea: { w: number; h: number }): Promise<string> => {
  const tempPath = path.join(TEMP_DIR, `prep_${uuid()}.png`);

  await new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .outputOptions([
        `-vf`, `scale=${targetArea.w}:${targetArea.h}:force_original_aspect_ratio=increase,crop=${targetArea.w}:${targetArea.h}`
      ])
      .output(tempPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  return tempPath;
};
```

This ensures user photos are cropped/scaled to fit the template's image area without distortion.

---

## 9) Content Persistence

### 9.1 Contents table write (image type)

```typescript
const { data: content } = await supabaseAdmin
  .from("contents")
  .insert({
    org_id: orgId,
    channel: "instagram",
    content_type: "image",
    status: "draft",
    body: captionText,              // caption stored in body
    metadata: {
      generation_model: modelUsed,
      generation_tokens: { prompt: promptTokens, completion: completionTokens },
      topic: topic,
      source: isOnDemand ? "ondemand" : "campaign",
      campaign_id: campaignId ?? null,
      hashtags: extractedHashtags,
      template_id: templateId,
      overlay_main: overlayMainText,
      overlay_sub: overlaySubText,
      image_paths: selectedImagePaths,
      composed_image_size: composedResult.sizeBytes,
    },
    scheduled_at: slot.scheduled_date,
    created_by: "ai",
  })
  .select("id")
  .single();
```

### 9.2 Composed image storage

The composed PNG/JPG needs to be stored. Two storage targets:

1. **Supabase Storage** (remote) — for API access and scheduler preview.
   - Bucket: `content-images`
   - Path: `{orgId}/{contentId}/composed.png`
   - URL stored in `contents.metadata.composed_image_url`

2. **Local file** (via IPC) — for user's local archive.
   - Path follows 7-1a local save convention.

```typescript
// Upload to Supabase Storage
const storagePath = `${orgId}/${content.id}/composed.png`;
await supabaseAdmin.storage
  .from("content-images")
  .upload(storagePath, composedBuffer, { contentType: "image/png" });

const { data: { publicUrl } } = supabaseAdmin.storage
  .from("content-images")
  .getPublicUrl(storagePath);

// Update content metadata with image URL
await supabaseAdmin
  .from("contents")
  .update({ metadata: { ...metadata, composed_image_url: publicUrl } })
  .eq("id", content.id);
```

### 9.3 Schedule slot linking

Same pattern as 7-1a:

```typescript
await supabaseAdmin
  .from("schedule_slots")
  .update({
    content_id: content.id,
    slot_status: "draft",
    updated_at: new Date().toISOString(),
  })
  .eq("id", slotId)
  .eq("lock_version", currentLockVersion);
```

### 9.4 On-demand slot creation

Same pattern as 7-1a but with `channel: "instagram"` and `content_type: "image"`:

```typescript
const { data: slot } = await supabaseAdmin
  .from("schedule_slots")
  .insert({
    org_id: orgId,
    session_id: sessionId,
    campaign_id: null,
    channel: "instagram",
    content_type: "image",
    title: extractedTopic,
    scheduled_date: new Date().toISOString().split("T")[0],
    slot_status: "generating",
    metadata: { source: "ondemand" },
  })
  .select("id, lock_version")
  .single();
```

---

## 10) Skill Execution Flow (Complete)

```
User: "인스타 게시물 만들어줘"
  → Skill router: instagram_generation (confidence 0.88+)

[ON-DEMAND PATH]
  → Phase: "topic"
  AI: "어떤 주제의 인스타 게시물을 만들까요?"
  User: "봄 나들이 행사 홍보"
  → Phase: "image_selection"
  AI: "이미지 선택 방법을 골라주세요: 1) AI 자동 2) 직접 선택 3) 텍스트만"
  User: "1"
  → Phase: "template_selection"
  AI: "템플릿을 선택해주세요: 1) 중앙 이미지... 2) ... 4) AI 추천"
  User: "1"
  → Phase: "generating"

[GENERATION PIPELINE]
  1. Create schedule_slot (on-demand) or load existing (campaign)
  2. Update slot_status → "generating"
  3. Assemble RAG context (brand profile + activity files + memory)
  4. Generate caption + overlay text via LLM (Claude → GPT-4o-mini fallback)
  5. Select image(s) via LLM or use user-selected paths
  6. Preprocess user image(s) for template fit
  7. Compose image via ffmpeg (template + images + text overlay)
  8. Upload composed image to Supabase Storage
  9. Insert contents row (channel: instagram, content_type: image)
  10. Link content_id to schedule_slot, status → "draft"
  11. Save composed image + caption to local file via IPC
  12. Return chat reply with completion card

  → Phase: "complete"
```

---

## 11) API Routes

### 11.1 Template listing

Route: `GET /orgs/:orgId/templates/instagram`

Returns available template summaries for the survey step. No auth beyond org membership.

```typescript
// Response
{
  templates: [
    { id: "center-image-bottom-text", nameKo: "중앙 이미지 + 하단 텍스트", description: "..." },
    ...
  ]
}
```

### 11.2 Activity folder images

Route: `GET /orgs/:orgId/activity-images`

Returns indexed image files from the user's activity folder (from Phase 5-1 watcher data). Used by chat to display available images for manual selection.

```typescript
// Response
{
  images: [
    { fileName: "event_photo.jpg", filePath: "활동폴더/photos/event_photo.jpg", fileSize: 2048000, detectedAt: "..." },
    ...
  ]
}
```

---

## 12) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/media/ffmpeg-client.ts` | Create | FFmpeg wrapper (shared for image + future video) |
| `apps/api/src/media/image-composer.ts` | Create | Instagram image composition pipeline |
| `apps/api/src/media/templates/schema.ts` | Create | Template type definitions |
| `apps/api/src/media/templates/registry.ts` | Create | Template loader + registry |
| `apps/api/src/media/templates/presets/*.json` | Create | 5 starter template definitions |
| `apps/api/src/media/templates/fonts/*.otf` | Create | Korean font files (Pretendard, Noto Sans KR) |
| `apps/api/src/media/index.ts` | Create | Module exports |
| `apps/api/src/orchestrator/skills/instagram-generation/index.ts` | Create | Skill definition + execute |
| `apps/api/src/orchestrator/skills/instagram-generation/intent.ts` | Create | Intent matching |
| `apps/api/src/orchestrator/skills/instagram-generation/survey.ts` | Create | On-demand mini survey |
| `apps/api/src/orchestrator/skills/instagram-generation/prompt.ts` | Create | Caption + overlay prompt |
| `apps/api/src/orchestrator/skills/instagram-generation/image-selector.ts` | Create | LLM-assisted image selection |
| `apps/api/src/orchestrator/skills/instagram-generation/generate.ts` | Create | Orchestrate full generation pipeline |
| `apps/api/src/orchestrator/skills/router.ts` | Modify | Register instagram_generation skill |
| `apps/api/src/routes/sessions.ts` | Modify | Add template listing + activity images routes |
| `apps/api/package.json` | Modify | Add fluent-ffmpeg, ffmpeg-static deps |

---

## 13) Acceptance Criteria

1. User can request "인스타 게시물 만들어" → skill activates with confidence >= 0.88.
2. On-demand flow completes 2-3 turn mini survey (topic → image mode → template).
3. Campaign-scheduled flow skips survey and uses campaign plan context.
4. Caption is generated with correct format (hook + body + CTA + hashtags).
5. Overlay text (main + sub) is generated within character limits.
6. FFmpeg composes template + user image + text overlay into 1080x1080 PNG.
7. Korean text renders correctly in composed image (Pretendard/Noto Sans KR font).
8. Composed image is uploaded to Supabase Storage with public URL.
9. Content is saved to `contents` table with `content_type: "image"`, caption in `body`.
10. Schedule slot is created (on-demand) or linked (campaign) with `slot_status: "draft"`.
11. LLM-assisted image selection picks relevant images from activity folder.
12. Claude → GPT-4o-mini fallback works on transient failures (5xx, 429, timeout).
13. `pnpm --filter @repo/api type-check` passes.

---

## 14) Verification Plan

1. `pnpm --filter @repo/api type-check` — pass
2. `pnpm --filter @repo/api test:unit` — new tests for intent matching, survey state, template loading, ffmpeg composition
3. Manual: send "인스타 게시물 만들어" → verify survey flow completes
4. Manual: verify composed PNG is 1080x1080 with correct text overlay and user image
5. Manual: verify Korean text renders without garbled characters in composed image
6. Manual: verify Supabase Storage upload and public URL accessibility
7. Manual: verify contents + schedule_slots rows are correctly created and linked
8. Manual: test text-only template (no user image) → verify gradient background + text renders
9. Manual: test fallback by disabling Anthropic key → verify GPT-4o-mini generates caption

---

## 15) Decisions

**Why ffmpeg over Sharp/PIL:**
FFmpeg will be reused for video composition (shorts/reels) in future phases. Single media engine reduces complexity. `drawtext` filter handles Korean with explicit font paths. `ffmpeg-static` npm package bundles the binary for cross-platform dev.

**Why 5 starter templates:**
Minimum viable template set covering the most common Instagram post layouts. Custom template creation (user-designed or AI-analyzed from existing posts) is deferred to a later phase.

**Why Supabase Storage for composed images:**
Scheduler board needs to display image previews. Local-only storage would require IPC round-trip for every preview. Supabase Storage provides public URLs for direct `<img>` rendering in the desktop app.

**Why mini survey for on-demand:**
Instagram content requires more input than blog text (image choice, template, visual style). A 2-3 turn survey is the minimum to produce a reasonable result without over-engineering.
