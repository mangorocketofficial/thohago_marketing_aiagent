# Phase 7-2a: Instagram Content Generation — Backend Core

- Date: 2026-03-05
- Status: Planning
- Scope: `instagram_generation` skill, caption generation, Sharp image engine foundation, template system, image selection, content persistence
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
3. **Establish Sharp image engine** for image composition (text rendering via SVG, image overlay via `composite()`).
4. **Define template system** with 3-5 starter templates for 1080x1080 Instagram posts.
5. **Implement image selection** — LLM picks from user's indexed activity folder images, or user selects manually.
6. **Compose final image** — Sharp combines template background + user photo + SVG text overlay → PNG output.
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

## 5) Sharp Image Engine Foundation

### 5.1 Why Sharp (not ffmpeg)

| Concern | Sharp (libvips) | ffmpeg drawtext |
|---|---|---|
| Text auto-wrap | SVG `<text>` with `word-wrap` | Not supported |
| Korean rendering | SVG + `@font-face` — stable | Font path issues common |
| Text alignment | SVG `text-anchor` | Very limited |
| Gradient backgrounds | SVG `linearGradient` | Complex filter chain |
| Image resize/crop | `sharp.resize()` one-liner | `-vf scale,crop` verbose |
| Performance (1080px) | ~50-100ms | ~300-500ms |
| Bundle size | ~30MB | ~70-100MB |

ffmpeg is deferred to a future video/reels phase where its strengths (timeline, audio, frame sequencing) are essential. Image composition uses Sharp exclusively.

### 5.2 Module structure

```
apps/api/src/media/
  ├── sharp-client.ts         ← Sharp wrapper (image composition engine)
  ├── svg-renderer.ts         ← SVG text overlay builder
  ├── image-composer.ts       ← Instagram image composition orchestrator
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

### 5.3 Sharp client wrapper

File: `apps/api/src/media/sharp-client.ts` (new)

```typescript
import sharp from "sharp";
import path from "path";

export type CompositeLayer = {
  type: "image" | "svg";      // explicit for type-check safety
  input: Buffer | string;        // Buffer for SVG/processed image, string for file path
  top: number;
  left: number;
  opacity?: number;              // optional layer alpha (e.g., brand logo watermark)
};

export type ComposeOptions = {
  width: number;
  height: number;
  background: Buffer;             // Pre-built background (solid color, gradient, or image)
  layers: CompositeLayer[];
  outputFormat: "png" | "jpg";
  quality?: number;               // 1-100 for jpg
};

/**
 * Compose multiple layers into a single image using Sharp.
 * Background is the base layer; additional layers are composited on top.
 */
export const composeImage = async (options: ComposeOptions): Promise<Buffer> => {
  const compositeInputs: sharp.OverlayOptions[] = options.layers.map((layer) => ({
    input: typeof layer.input === "string"
      ? layer.input   // file path
      : layer.input,  // Buffer (SVG or pre-processed image)
    top: layer.top,
    left: layer.left,
  }));

  const result = await sharp(options.background)
    .resize(options.width, options.height, { fit: "cover" })
    .composite(compositeInputs)
    .toFormat(options.outputFormat, {
      quality: options.quality ?? (options.outputFormat === "jpg" ? 90 : undefined),
    })
    .toBuffer();

  return result;
};

/**
 * Create a solid color background as a Buffer.
 */
export const createSolidBackground = async (
  width: number,
  height: number,
  color: string
): Promise<Buffer> => {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
};

/**
 * Create a gradient background via SVG rendered through Sharp.
 */
export const createGradientBackground = async (
  width: number,
  height: number,
  colors: [string, string],
  direction: "vertical" | "horizontal" | "diagonal"
): Promise<Buffer> => {
  const [x1, y1, x2, y2] = gradientCoords(direction);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
          <stop offset="0%" stop-color="${colors[0]}"/>
          <stop offset="100%" stop-color="${colors[1]}"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
    </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
};

const gradientCoords = (
  direction: "vertical" | "horizontal" | "diagonal"
): [string, string, string, string] => {
  switch (direction) {
    case "vertical":   return ["0%", "0%", "0%", "100%"];
    case "horizontal": return ["0%", "0%", "100%", "0%"];
    case "diagonal":   return ["0%", "0%", "100%", "100%"];
  }
};

/**
 * Resize and crop a user image to fit a target area (cover mode).
 * Returns a Buffer of the processed image.
 */
export const preprocessUserImage = async (
  imagePath: string,
  targetWidth: number,
  targetHeight: number,
  fit: "cover" | "contain" = "cover"
): Promise<Buffer> => {
  return sharp(imagePath)
    .resize(targetWidth, targetHeight, {
      fit: fit === "contain" ? "contain" : "cover",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
};

/**
 * Apply a semi-transparent dark overlay on an image (for fullscreen-overlay template).
 */
export const applyDarkOverlay = async (
  imageBuffer: Buffer,
  width: number,
  height: number,
  opacity: number  // 0.0 - 1.0
): Promise<Buffer> => {
  const alpha = Math.round(opacity * 255);
  const overlay = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: alpha / 255 },
    },
  })
    .png()
    .toBuffer();

  return sharp(imageBuffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .toBuffer();
};

/**
 * Apply rounded corners mask for template image cards.
 */
export const applyRoundedCorners = async (
  imageBuffer: Buffer,
  width: number,
  height: number,
  radius: number
): Promise<Buffer> => {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white" />
    </svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), blend: "dest-in" }])
    .png()
    .toBuffer();
};

/**
 * Apply global alpha to an image layer (e.g., brand logo watermark).
 */
export const applyImageOpacity = async (imageBuffer: Buffer, opacity: number): Promise<Buffer> => {
  const normalized = Math.max(0, Math.min(1, opacity));
  return sharp(imageBuffer)
    .ensureAlpha(normalized)
    .png()
    .toBuffer();
};
```

### 5.4 SVG text renderer

File: `apps/api/src/media/svg-renderer.ts` (new)

```typescript
import path from "path";
import fs from "fs";

export type TextOverlayOptions = {
  text: string;
  fontSize: number;
  fontWeight: "regular" | "bold";
  fontColor: string;
  align: "center" | "left" | "right";
  maxWidth: number;
  lineSpacing?: number;
};

/**
 * Build an SVG buffer for text overlay.
 * Uses embedded font via @font-face for consistent Korean rendering.
 * Sharp renders SVG natively — no external dependencies needed.
 */
export const buildTextOverlaySvg = (options: TextOverlayOptions): Buffer => {
  const fontFamily = "Pretendard";
  const fontFile = getFontPath(options.fontWeight);
  const fontBase64 = fs.readFileSync(fontFile).toString("base64");
  const lineHeight = options.fontSize * (options.lineSpacing ?? 1.4);
  const textAnchor = alignToAnchor(options.align);
  const xPos = anchorXPosition(options.align, options.maxWidth);

  // Estimate lines needed (conservative: ~0.6em per Korean char)
  const charsPerLine = Math.floor(options.maxWidth / (options.fontSize * 0.6));
  const lines = wrapText(options.text, charsPerLine);
  const svgHeight = Math.ceil(lines.length * lineHeight + options.fontSize);

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${xPos}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("\n      ");

  const svg = `
    <svg width="${options.maxWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: '${fontFamily}';
            src: url('data:font/otf;base64,${fontBase64}');
            font-weight: ${options.fontWeight === "bold" ? 700 : 400};
          }
        </style>
      </defs>
      <text
        x="${xPos}" y="${options.fontSize}"
        font-family="${fontFamily}" font-size="${options.fontSize}"
        font-weight="${options.fontWeight === "bold" ? 700 : 400}"
        fill="${options.fontColor}"
        text-anchor="${textAnchor}">
        ${tspans}
      </text>
    </svg>`;

  return Buffer.from(svg);
};

/**
 * Simple word-wrap for Korean text.
 * Korean doesn't use spaces consistently, so we break by character count.
 */
const wrapText = (text: string, maxChars: number): string[] => {
  if (text.length <= maxChars) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }

    // Try to break at a space within the limit
    let breakPoint = remaining.lastIndexOf(" ", maxChars);
    if (breakPoint <= 0) {
      // No space found — break at maxChars for Korean text
      breakPoint = maxChars;
    }

    lines.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return lines;
};

const alignToAnchor = (align: "center" | "left" | "right"): string => {
  switch (align) {
    case "center": return "middle";
    case "left":   return "start";
    case "right":  return "end";
  }
};

const anchorXPosition = (align: "center" | "left" | "right", maxWidth: number): number => {
  switch (align) {
    case "center": return Math.round(maxWidth / 2);
    case "left":   return 0;
    case "right":  return maxWidth;
  }
};

const escapeXml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const getFontPath = (weight: "regular" | "bold"): string => {
  const fileName = weight === "bold" ? "Pretendard-Bold.otf" : "Pretendard-Regular.otf";
  return path.resolve(__dirname, "templates/fonts", fileName);
};
```

### 5.5 Dependency installation

```bash
pnpm --filter @repo/api add sharp
pnpm --filter @repo/api add -D @types/sharp
```

Sharp bundles platform-appropriate libvips binaries (~30MB). No system-level install required. Works in Electron and Docker without extra configuration.

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
  thumbnail?: string;      // optional: defaults to /templates/instagram/{id}.png
};

export type BackgroundDef =
  | { type: "solid"; color: string }
  | { type: "gradient"; colors: [string, string]; direction: "vertical" | "horizontal" | "diagonal" }
  | { type: "image"; placeholder: "user_photo" };  // user image fills background

export type TemplateLayers = {
  userImageAreas?: Array<{
    x: number; y: number; w: number; h: number;
    fit: "cover" | "contain";
    borderRadius?: number;
  }>;
  darkOverlay?: {
    opacity: number;  // 0.0-1.0, for fullscreen-overlay template
  };
  mainText: {
    x: number; y: number;
    maxWidth: number;
    fontSize: number;
    fontWeight: "regular" | "bold";
    fontColor: string;
    align: "center" | "left" | "right";
    lineSpacing?: number;
  };
  subText?: {
    x: number; y: number;
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

Key changes from original:
- `userImageArea` → `userImageAreas` (array) — supports collage templates with multiple image slots.
- `darkOverlay` added — for fullscreen-overlay template's semi-transparent layer.
- Text positions use numeric `x`, `y` only (no string expressions) — Sharp uses pixel coordinates directly, not ffmpeg expressions.

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
  "thumbnail": "thumbnails/center-image-bottom-text.png",
  "background": { "type": "solid", "color": "#FFFFFF" },
  "layers": {
    "userImageAreas": [
      { "x": 40, "y": 40, "w": 1000, "h": 700, "fit": "cover" }
    ],
    "mainText": {
      "x": 60, "y": 790,
      "maxWidth": 960,
      "fontSize": 52,
      "fontWeight": "bold",
      "fontColor": "#1A1A1A",
      "align": "center"
    },
    "subText": {
      "x": 60, "y": 860,
      "maxWidth": 960,
      "fontSize": 32,
      "fontWeight": "regular",
      "fontColor": "#666666",
      "align": "center"
    }
  }
}
```

File: `apps/api/src/media/templates/presets/fullscreen-overlay.json`

```json
{
  "id": "fullscreen-overlay",
  "name": "Fullscreen Overlay",
  "nameKo": "전면 이미지 + 오버레이 텍스트",
  "description": "User photo fills entire frame with dark overlay and white centered text",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "thumbnail": "thumbnails/fullscreen-overlay.png",
  "background": { "type": "image", "placeholder": "user_photo" },
  "layers": {
    "darkOverlay": { "opacity": 0.4 },
    "mainText": {
      "x": 60, "y": 440,
      "maxWidth": 960,
      "fontSize": 56,
      "fontWeight": "bold",
      "fontColor": "#FFFFFF",
      "align": "center"
    },
    "subText": {
      "x": 60, "y": 540,
      "maxWidth": 960,
      "fontSize": 30,
      "fontWeight": "regular",
      "fontColor": "#E0E0E0",
      "align": "center"
    }
  }
}
```

File: `apps/api/src/media/templates/presets/collage-2x2.json`

```json
{
  "id": "collage-2x2",
  "name": "Collage 2x2",
  "nameKo": "콜라주 (2x2)",
  "description": "4 image slots in a 2x2 grid with text at bottom",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "thumbnail": "thumbnails/collage-2x2.png",
  "background": { "type": "solid", "color": "#FFFFFF" },
  "layers": {
    "userImageAreas": [
      { "x": 10, "y": 10, "w": 525, "h": 400, "fit": "cover" },
      { "x": 545, "y": 10, "w": 525, "h": 400, "fit": "cover" },
      { "x": 10, "y": 420, "w": 525, "h": 400, "fit": "cover" },
      { "x": 545, "y": 420, "w": 525, "h": 400, "fit": "cover" }
    ],
    "mainText": {
      "x": 60, "y": 870,
      "maxWidth": 960,
      "fontSize": 44,
      "fontWeight": "bold",
      "fontColor": "#1A1A1A",
      "align": "center"
    },
    "subText": {
      "x": 60, "y": 940,
      "maxWidth": 960,
      "fontSize": 28,
      "fontWeight": "regular",
      "fontColor": "#666666",
      "align": "center"
    }
  }
}
```

File: `apps/api/src/media/templates/presets/text-only-gradient.json`

```json
{
  "id": "text-only-gradient",
  "name": "Text Only Gradient",
  "nameKo": "텍스트 전용 (그라디언트)",
  "description": "Gradient background with large centered text, no user photo",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "thumbnail": "thumbnails/text-only-gradient.png",
  "background": { "type": "gradient", "colors": ["#667eea", "#764ba2"], "direction": "diagonal" },
  "layers": {
    "mainText": {
      "x": 90, "y": 400,
      "maxWidth": 900,
      "fontSize": 64,
      "fontWeight": "bold",
      "fontColor": "#FFFFFF",
      "align": "center",
      "lineSpacing": 1.5
    },
    "subText": {
      "x": 90, "y": 560,
      "maxWidth": 900,
      "fontSize": 36,
      "fontWeight": "regular",
      "fontColor": "#E8E8FF",
      "align": "center"
    }
  }
}
```

File: `apps/api/src/media/templates/presets/split-image-text.json`

```json
{
  "id": "split-image-text",
  "name": "Split Image + Text",
  "nameKo": "좌측 이미지 + 우측 텍스트",
  "description": "Left half image, right half solid color with text",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "thumbnail": "thumbnails/split-image-text.png",
  "background": { "type": "solid", "color": "#F5F0EB" },
  "layers": {
    "userImageAreas": [
      { "x": 0, "y": 0, "w": 540, "h": 1080, "fit": "cover" }
    ],
    "mainText": {
      "x": 580, "y": 400,
      "maxWidth": 460,
      "fontSize": 48,
      "fontWeight": "bold",
      "fontColor": "#2D2D2D",
      "align": "left",
      "lineSpacing": 1.4
    },
    "subText": {
      "x": 580, "y": 540,
      "maxWidth": 460,
      "fontSize": 28,
      "fontWeight": "regular",
      "fontColor": "#777777",
      "align": "left"
    }
  }
}
```

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
import sharp from "sharp";
import {
  composeImage,
  createSolidBackground,
  createGradientBackground,
  preprocessUserImage,
  applyDarkOverlay,
  applyRoundedCorners,
  applyImageOpacity,
  type CompositeLayer,
} from "./sharp-client";
import { buildTextOverlaySvg } from "./svg-renderer";
import { getTemplate } from "./templates/registry";
import type { TemplateId, BackgroundDef } from "./templates/schema";

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
 * Compose an Instagram image from template + user images + SVG text overlays.
 */
export const composeInstagramImage = async (
  input: ImageComposeInput
): Promise<ImageComposeResult> => {
  const template = getTemplate(input.templateId);
  if (!template) throw new Error(`Template not found: ${input.templateId}`);

  const { width, height } = template;

  // 1. Build background
  let background = await resolveBackground(template.background, input.userImages, width, height);

  // 2. Apply dark overlay if template requires it
  if (template.layers.darkOverlay) {
    background = await applyDarkOverlay(
      background, width, height, template.layers.darkOverlay.opacity
    );
  }

  // 3. Build composite layers
  const layers: CompositeLayer[] = [];

  // User image layers (supports multiple for collage)
  if (template.layers.userImageAreas && input.userImages.length > 0) {
    for (let i = 0; i < template.layers.userImageAreas.length; i++) {
      const area = template.layers.userImageAreas[i];
      const imagePath = input.userImages[i % input.userImages.length]; // cycle if fewer images
      if (!imagePath) continue;

      let processedImage = await preprocessUserImage(imagePath, area.w, area.h, area.fit);
      if (area.borderRadius && area.borderRadius > 0) {
        processedImage = await applyRoundedCorners(processedImage, area.w, area.h, area.borderRadius);
      }
      layers.push({ type: "image", input: processedImage, top: area.y, left: area.x });
    }
  }

  // Main text overlay (SVG)
  const mainTextSvg = buildTextOverlaySvg({
    text: input.overlayMainText,
    fontSize: template.layers.mainText.fontSize,
    fontWeight: template.layers.mainText.fontWeight,
    fontColor: template.layers.mainText.fontColor,
    align: template.layers.mainText.align,
    maxWidth: template.layers.mainText.maxWidth,
    lineSpacing: template.layers.mainText.lineSpacing,
  });
  layers.push({
    type: "svg",
    input: mainTextSvg,
    top: template.layers.mainText.y,
    left: template.layers.mainText.x,
  });

  // Sub text overlay (optional)
  if (template.layers.subText && input.overlaySubText) {
    const subTextSvg = buildTextOverlaySvg({
      text: input.overlaySubText,
      fontSize: template.layers.subText.fontSize,
      fontWeight: template.layers.subText.fontWeight,
      fontColor: template.layers.subText.fontColor,
      align: template.layers.subText.align,
      maxWidth: template.layers.subText.maxWidth,
    });
    layers.push({
      type: "svg",
      input: subTextSvg,
      top: template.layers.subText.y,
      left: template.layers.subText.x,
    });
  }

  // Brand logo (optional)
  if (template.layers.brandLogo && input.brandLogoPath) {
    let logoBuffer = await preprocessUserImage(
      input.brandLogoPath,
      template.layers.brandLogo.w,
      template.layers.brandLogo.h,
      "contain"
    );
    if (template.layers.brandLogo.opacity < 1) {
      logoBuffer = await applyImageOpacity(logoBuffer, template.layers.brandLogo.opacity);
    }
    layers.push({
      type: "image",
      input: logoBuffer,
      top: template.layers.brandLogo.y,
      left: template.layers.brandLogo.x,
    });
  }

  // 4. Compose all layers via Sharp
  const buffer = await composeImage({
    width,
    height,
    background,
    layers,
    outputFormat: input.outputFormat,
  });

  return {
    buffer,
    width,
    height,
    format: input.outputFormat,
    sizeBytes: buffer.length,
  };
};

/**
 * Resolve background definition into a Sharp-ready Buffer.
 */
const resolveBackground = async (
  bgDef: BackgroundDef,
  userImages: string[],
  width: number,
  height: number
): Promise<Buffer> => {
  switch (bgDef.type) {
    case "solid":
      return createSolidBackground(width, height, bgDef.color);
    case "gradient":
      return createGradientBackground(width, height, bgDef.colors, bgDef.direction);
    case "image": {
      if (userImages.length === 0) {
        // Fallback to neutral gray if no user image provided
        return createSolidBackground(width, height, "#E0E0E0");
      }
      // Use first user image as full background
      return sharp(userImages[0])
        .resize(width, height, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    }
  }
};
```

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
   - Bucket: `content-images-private` (private bucket)
   - Path: `{orgId}/{contentId}/composed.{ext}` (`ext` follows `outputFormat`)
   - Metadata stores `storage_path` only; preview uses short-lived signed URL.

2. **Local file** (via IPC) — for user's local archive.
   - Path follows 7-1a local save convention.

```typescript
const extension = outputFormat === "jpg" ? "jpg" : "png";
const contentType = outputFormat === "jpg" ? "image/jpeg" : "image/png";
const bucket = "content-images-private";
const storagePath = `${orgId}/${content.id}/composed.${extension}`;

// 1) Upload image first
const uploadRes = await supabaseAdmin.storage
  .from(bucket)
  .upload(storagePath, composedBuffer, { contentType, upsert: false });
if (uploadRes.error) throw new Error(`storage_upload_failed:${uploadRes.error.message}`);

// 2) Update content metadata with storage path
const updateRes = await supabaseAdmin
  .from("contents")
  .update({
    metadata: {
      ...metadata,
      composed_image_storage: { bucket, path: storagePath, content_type: contentType }
    }
  })
  .eq("id", content.id)
  .eq("org_id", orgId)
  .select("id")
  .maybeSingle();

// 3) Rollback upload when DB update fails (atomicity guard)
if (updateRes.error || !updateRes.data) {
  await supabaseAdmin.storage.from(bucket).remove([storagePath]);
  throw new Error(`content_metadata_update_failed:${updateRes.error?.message ?? "conflict"}`);
}

// 4) Create short-lived signed URL for preview API response (never persist public URL)
const signedRes = await supabaseAdmin.storage
  .from(bucket)
  .createSignedUrl(storagePath, 60 * 30); // 30 min
const previewUrl = signedRes.data?.signedUrl ?? null;
```

### 9.3 Storage atomicity and idempotency notes

- Idempotency key is stored on both slot metadata and content metadata (`request_idempotency_key`).
- Re-run with same key first checks existing slot/content linkage before creating new rows.
- If any step after upload fails, uploaded object is removed (`remove`) to avoid orphan files.
- A daily cleanup job can safely remove orphan storage paths older than 24h.

### 9.4 Schedule slot linking

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

### 9.5 On-demand slot creation

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
  6. Preprocess user image(s) via Sharp (resize + crop to template area)
  7. Build SVG text overlays for main + sub text
  8. Compose image via Sharp composite (background + images + SVG text → PNG/JPG)
  9. Upload composed image to Supabase Storage private bucket
  10. Insert contents row (channel: instagram, content_type: image)
  11. Link content_id to schedule_slot, status → "draft"
  12. Save composed image + caption to local file via IPC
  13. Return chat reply with completion card

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
Do not expose absolute local paths in API responses; return `file_id` + relative path only.

```typescript
// Response
{
  images: [
    {
      fileId: "8e3f...",
      fileName: "event_photo.jpg",
      relativePath: "활동폴더/photos/event_photo.jpg",
      fileSize: 2048000,
      detectedAt: "..."
    },
    ...
  ]
}
```

---

## 12) Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/api/src/media/sharp-client.ts` | Create | Sharp wrapper (image composition, backgrounds, preprocessing) |
| `apps/api/src/media/svg-renderer.ts` | Create | SVG text overlay builder (Korean font embedding, word-wrap) |
| `apps/api/src/media/image-composer.ts` | Create | Instagram image composition orchestrator |
| `apps/api/src/media/templates/schema.ts` | Create | Template type definitions (multi-image, dark overlay support) |
| `apps/api/src/media/templates/registry.ts` | Create | Template loader + registry |
| `apps/api/src/media/templates/presets/*.json` | Create | 5 starter template definitions (all with concrete coordinates) |
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
| `apps/api/package.json` | Modify | Add `sharp` dependency |

---

## 13) Acceptance Criteria

1. User can request "인스타 게시물 만들어" → skill activates with confidence >= 0.88.
2. On-demand flow completes 2-3 turn mini survey (topic → image mode → template).
3. Campaign-scheduled flow skips survey and uses campaign plan context.
4. Caption is generated with correct format (hook + body + CTA + hashtags).
5. Overlay text (main + sub) is generated within character limits.
6. Sharp composes template + user image + SVG text overlay into 1080x1080 PNG/JPG.
7. Korean text renders correctly in composed image (Pretendard font via SVG `@font-face`).
8. Gradient background renders correctly for `text-only-gradient` template.
9. Collage template correctly places 2-4 images in grid layout.
10. Composed image is uploaded to Supabase Storage private bucket and exposed via signed URL.
11. Content is saved to `contents` table with `content_type: "image"`, caption in `body`.
12. Schedule slot is created (on-demand) or linked (campaign) with `slot_status: "draft"`.
13. LLM-assisted image selection picks relevant images from activity folder.
14. Claude → GPT-4o-mini fallback works on transient failures (5xx, 429, timeout).
15. Template `fit`, `borderRadius`, and `brandLogo.opacity` are applied in composition output.
16. Storage upload + DB metadata update behaves atomically (rollback upload on DB failure).
17. `pnpm --filter @repo/api type-check` passes.

---

## 14) Verification Plan

1. `pnpm --filter @repo/api type-check` — pass
2. `pnpm --filter @repo/api test:unit` — new tests for intent matching, survey state, template loading, Sharp composition
3. Unit test: `composeInstagramImage` with `center-image-bottom-text` template → verify output is 1080x1080 PNG buffer
4. Unit test: `buildTextOverlaySvg` with Korean text → verify SVG contains correct font-face and tspan elements
5. Unit test: `createGradientBackground` → verify output buffer is valid PNG
6. Manual: send "인스타 게시물 만들어" → verify survey flow completes
7. Manual: verify composed image (PNG/JPG) is 1080x1080 with correct text overlay and user image
8. Manual: verify Korean text renders without garbled characters in composed image
9. Manual: verify Supabase Storage upload to private bucket and signed URL accessibility (expires as expected)
10. Manual: verify contents + schedule_slots rows are correctly created and linked
11. Manual: test text-only-gradient template → verify gradient background + text renders
12. Manual: test collage-2x2 template with 4 images → verify grid layout
13. Manual: force DB metadata update failure after storage upload → verify uploaded object is rolled back (no orphan)
14. Manual: test fallback by disabling Anthropic key → verify GPT-4o-mini generates caption

---

## 15) Decisions

**Why Sharp over ffmpeg for image composition:**
Sharp (libvips) provides native SVG text rendering with `@font-face` support, enabling proper Korean text layout with auto-wrap, alignment, and consistent font rendering. ffmpeg `drawtext` lacks auto-wrap and has unreliable Korean font handling. Sharp is ~4-6x faster for static image composition (~50-100ms vs ~300-500ms) and ~30MB vs ~70-100MB bundle size. ffmpeg is deferred to a future video/reels phase where its timeline and audio capabilities are essential.

**Why SVG for text overlays (not Canvas API):**
Sharp renders SVG natively without additional dependencies. SVG provides declarative text layout (`text-anchor`, `@font-face`, `tspan` for multi-line) that maps cleanly from template JSON. Canvas API would require imperative code and additional `@napi-rs/canvas` dependency (~40MB).

**Why `userImageAreas` as array (not single object):**
Collage templates (2x2, future 3-grid, etc.) need multiple image placement areas. A single `userImageArea` would require template-specific hacks. Array-based design handles 1-to-N images uniformly.

**Why 5 starter templates:**
Minimum viable template set covering the most common Instagram post layouts. Custom template creation (user-designed or AI-analyzed from existing posts) is deferred to a later phase.

**Why Supabase Storage for composed images:**
Scheduler board needs to display image previews. Local-only storage would require IPC round-trip for every preview. Supabase Storage enables centralized preview delivery, while private bucket + signed URLs avoid exposing org image paths publicly.

**Why rollback on storage/DB mismatch:**
Content generation writes across two systems (Storage + Postgres). If DB update fails after upload, rollback (`storage.remove`) prevents orphan files and keeps retries idempotent.

**Why mini survey for on-demand:**
Instagram content requires more input than blog text (image choice, template, visual style). A 2-3 turn survey is the minimum to produce a reasonable result without over-engineering.
