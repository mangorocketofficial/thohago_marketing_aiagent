# Phase 7-4: Instagram Multi-Image Carousel Support

- Date: 2026-03-08
- Status: Done
- Scope: Carousel generation, per-slide composition, slide navigation editor
- Depends on: Phase 7-2a (Instagram generation backend), Phase 7-2b (canvas editor), Phase 7-2.2 (template schema)
- Maps to: Phase 7 content creation pipeline

---

## 1) Problem

The current Instagram generation system produces one image per post. In practice, carousel posts with multiple slides are common:

1. Information cards: each slide presents a different point or statistic.
2. Storytelling: cover -> problem -> solution -> CTA flow.
3. Before/after: comparative slides with different images.
4. Educational: step-by-step tutorials spread across slides.

The current system has no concept of multi-slide content. The LLM generates one overlay-text set, the composer outputs one PNG, and the editor previews one image.

---

## 2) Goals

1. LLM-driven carousel planning: the LLM autonomously decides slide count (1-10) and each slide's role based on topic analysis.
2. Per-slide content generation: each slide gets its own overlay texts while sharing one caption and hashtag set.
3. Per-slide image selection: select enough images for all slides and assign them to each slide.
4. Per-slide composition: compose each slide independently using the same template with different text and image content.
5. Carousel editor UI: slide navigation, per-slide text editing, per-slide image assignment.
6. Full backward compatibility: existing single-image content loads and edits unchanged.

---

## 3) Key Design Decisions

### 3.1 Single-step LLM generation

The LLM produces the full carousel structure (slide count, roles, per-slide content) in one call, not two.

Rationale:
- Overlay texts are short, so the full carousel fits within the existing response budget.
- It avoids an extra LLM round-trip.
- The model already has the full topic, brand, campaign, and reference context.
- Error handling stays simpler: one parse path and one retry path.

### 3.2 Generalized slide image model

`InstagramSlide` must support multiple image slots per slide:

- A carousel has many slides.
- Each slide uses one template.
- A template can define one or more photo slots.
- Therefore each slide may require one or more images.

This is important even if the current default template (`koica_cover_01`) uses only one photo slot. The data model must match the template schema so future templates do not require another migration.

### 3.3 `slides` is the canonical source of truth

For carousel-aware code, `slides` is the canonical field.

Top-level legacy fields remain for backward compatibility only:
- `overlay_texts` = derived from `slides[0].overlay_texts`
- `image_file_ids` = derived from `slides[0].image_file_ids`
- `image_paths` = derived from `slides[0].image_paths`

Rules:
- New carousel-aware read paths should prefer `slides`.
- Legacy single-image read paths may continue using top-level fields.
- Persistence should keep both in sync, but only `slides` should be treated as canonical.

### 3.4 Cache and download backward compatibility

Existing desktop compose/download logic assumes a single cache file: `composed.png`.

For carousel support:
- Cache all slide renders as `slide-0.png`, `slide-1.png`, ...
- Also keep `composed.png` as a compatibility alias for slide 0.

This preserves older preview/download paths while allowing multi-slide download behavior.

---

## 4) LLM Output Format

### 4.1 Carousel output

```json
{
  "caption": "Shared caption for the entire carousel post...",
  "hashtags": ["#tag1", "#tag2"],
  "slides": [
    {
      "role": "cover",
      "overlay_texts": {
        "title": "Cover title",
        "author": "Subtitle"
      },
      "suggested_image_keywords": ["intro", "event"]
    },
    {
      "role": "problem",
      "overlay_texts": {
        "title": "Problem statement",
        "author": "Why it matters"
      },
      "suggested_image_keywords": ["issue", "community"]
    },
    {
      "role": "cta",
      "overlay_texts": {
        "title": "Take action now",
        "author": "Learn more"
      },
      "suggested_image_keywords": ["action", "join"]
    }
  ],
  "suggested_image_keywords": ["keyword1", "keyword2"]
}
```

### 4.2 Single-image legacy output

```json
{
  "caption": "...",
  "hashtags": ["#tag1"],
  "overlay_texts": {
    "title": "...",
    "author": "..."
  },
  "suggested_image_keywords": ["keyword1"]
}
```

Parser behavior:
- If `slides` is omitted, treat the result as one slide.
- That synthetic slide should use the top-level `overlay_texts`.
- Image assignment happens after parsing, based on template slot count.

---

## 5) Data Model

### 5.1 New types

File: `apps/api/src/orchestrator/skills/instagram-generation/types.ts`

```typescript
export type InstagramSlideRole =
  | "cover"
  | "problem"
  | "solution"
  | "benefit"
  | "data"
  | "detail"
  | "testimonial"
  | "cta"
  | "custom";

export type InstagramSlideDraft = {
  role: InstagramSlideRole;
  overlayTexts: Record<string, string>;
  suggestedImageKeywords?: string[];
};

export type InstagramSlide = {
  slideIndex: number;
  role: InstagramSlideRole;
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
};
```

### 5.2 Extended `InstagramDraft`

```typescript
export type InstagramDraft = {
  caption: string;
  hashtags: string[];
  overlayTexts: Record<string, string>;
  suggestedImageKeywords: string[];
  slides?: InstagramSlideDraft[];
};
```

### 5.3 Extended `InstagramGenerationResult`

```typescript
export type InstagramGenerationResult = {
  // existing fields
  overlayTexts: Record<string, string>; // derived from slides[0] for backward compat
  imageFileIds: string[]; // derived from slides[0] for backward compat
  selectedImagePaths: string[]; // derived from slides[0] for backward compat
  slides: InstagramSlide[]; // canonical
  isCarousel: boolean; // slides.length > 1
  // rest unchanged
};
```

### 5.4 Database metadata schema

No SQL migration is required. `contents.metadata` keeps existing fields and adds carousel fields:

```jsonc
{
  "overlay_texts": { "title": "..." },
  "template_id": "koica_cover_01",
  "image_file_ids": ["legacy-slide-0-image-id"],
  "image_paths": ["photos/cover.jpg"],

  "is_carousel": true,
  "slides": [
    {
      "slide_index": 0,
      "role": "cover",
      "overlay_texts": { "title": "...", "author": "..." },
      "image_file_ids": ["abc-123", "def-456"],
      "image_paths": ["photos/cover-1.jpg", "photos/cover-2.jpg"]
    },
    {
      "slide_index": 1,
      "role": "problem",
      "overlay_texts": { "title": "...", "author": "..." },
      "image_file_ids": ["ghi-789"],
      "image_paths": ["photos/problem.jpg"]
    }
  ]
}
```

Backward compatibility rule:
- If `slides` is absent or empty, read the content as one slide.
- That synthesized slide must use the full top-level `image_file_ids` and `image_paths`, not only index 0.
- Shared utility: `normalizeSlides(metadata)` returns `InstagramSlide[]`.

---

## 6) Implementation Phases

### Phase 1: Data model + server-side

#### 1-1. Type definitions

File: `apps/api/src/orchestrator/skills/instagram-generation/types.ts`

- Add `InstagramSlideRole`, `InstagramSlideDraft`, `InstagramSlide`.
- Extend `InstagramDraft` with optional `slides`.
- Extend `InstagramGenerationResult` with `slides` and `isCarousel`.

#### 1-2. Prompt changes

File: `apps/api/src/orchestrator/skills/instagram-generation/prompt.ts`

- Add a `[CAROUSEL_PLANNING]` section to `buildInstagramPrompt()`.
- Instruct the model:
  - Return `slides` for carousel-worthy topics.
  - Each slide must include `role` and `overlay_texts`.
  - If one image is enough, omit `slides`.
- Update `[OUTPUT_FORMAT]` with both carousel and single-image examples.
- Add slide parsing in `parseInstagramDraft()`:
  - Validate role.
  - Validate `overlay_texts`.
  - Clamp slide count to 1-10.

#### 1-3. Generation logic

File: `apps/api/src/orchestrator/skills/instagram-generation/generate.ts`

- Determine `perSlideImageCount` from the selected template.
- Determine `slideCount`.
- Calculate total required images: `slideCount * perSlideImageCount`.
- Pass the increased count to `selectImagesForInstagram()`.
- Partition selected images into per-slide chunks.
- Build `InstagramSlide[]`.
- Derive top-level legacy fields from `slides[0]`.
- Pass `slides` and `isCarousel` to persistence.

Important:
- Do not zip `slides` to images one-to-one.
- Images must be chunked per slide using template photo slot count.

#### 1-4. Persistence

File: `apps/api/src/orchestrator/skills/instagram-generation/persistence.ts`

- Accept `slides` and `isCarousel` in `insertDraftInstagramContent()`.
- Store `is_carousel` and `slides` in metadata JSON.
- Derive and store top-level legacy fields from slide 0.
- Add `normalizeSlides()` for reading both legacy and carousel metadata.
- Update `loadExistingGeneratedResult()` to return canonical `slides`.

#### 1-5. Image selection

File: `apps/api/src/orchestrator/skills/instagram-generation/image-selector.ts`

- Raise `requiredCount` cap from 4 to a carousel-safe upper bound (currently 40).
- Preserve deterministic ordering for chunking into slides.

#### 1-6. Editor metadata patch API

Files:
- `apps/api/src/routes/contents.ts`
- `apps/api/src/orchestrator/instagram-editor-shared.ts`

- Extend metadata patch input to accept slide-aware payloads.
- Save canonical `slides`.
- Re-derive top-level legacy fields from slide 0.
- Validate image slot counts per slide against the current template.

#### 1-7. Unit tests

- Prompt parsing:
  - carousel JSON
  - single-image JSON
  - malformed input
  - edge cases: 0 slides, 11 slides
- `normalizeSlides()`:
  - legacy metadata -> 1 slide
  - carousel metadata -> preserve all slides
- Generation:
  - `slideCount * perSlideImageCount` image chunking

---

### Phase 2: Media engine + Electron IPC

#### 2-1. Carousel compose helper

File: `packages/media-engine/src/image-composer.ts`

```typescript
export type CarouselComposeInput = {
  templateId: TemplateId;
  slides: Array<{
    userImages: string[];
    overlayTexts: Record<string, string>;
  }>;
  outputFormat: "png" | "jpg";
};

export type CarouselComposeResult = {
  slides: ImageComposeResult[];
};

export async function composeCarouselImages(
  input: CarouselComposeInput,
): Promise<CarouselComposeResult> {
  const results: ImageComposeResult[] = [];
  for (const slide of input.slides) {
    const result = await composeInstagramImage({
      templateId: input.templateId,
      userImages: slide.userImages,
      overlayTexts: slide.overlayTexts,
      outputFormat: input.outputFormat,
    });
    results.push(result);
  }
  return { slides: results };
}
```

`composeInstagramImage()` remains unchanged.

#### 2-2. IPC handlers

File: `apps/desktop/electron/main.mjs`

- Keep `content:compose-local` for legacy single-slide behavior.
- Add optional `slideIndex` so a single slide can be recomposed to `slide-{index}.png`.
- Continue updating `composed.png` when `slideIndex === 0`.
- Add `content:compose-carousel`:
  - accepts full slides array
  - writes `slide-0.png` through `slide-N.png`
  - also writes or refreshes `composed.png` from slide 0
  - returns thumbnail data URLs per slide

Cache layout:
- `contents/.instagram-cache/{contentId}/composed.png`
- `contents/.instagram-cache/{contentId}/slide-0.png`
- `contents/.instagram-cache/{contentId}/slide-1.png`
- ...

#### 2-3. IPC type updates

Files:
- `apps/desktop/src/global.d.ts`
- `apps/desktop/electron/preload.cjs`
- `apps/desktop/electron/preload.mjs`

- Add slide-aware payload/result types.
- Expose `content:compose-carousel`.

#### 2-4. Download behavior

File: `apps/desktop/electron/main.mjs`

- Single-slide: current behavior remains valid.
- Carousel:
  - prompt for destination directory
  - save all slide images as `slide-1.png` through `slide-N.png`

---

### Phase 3: Desktop editor state model

#### 3-1. Editor seed parsing

File: `apps/desktop/src/components/scheduler/instagram/metadata.ts`

- Add `InstagramEditorSlide`:

```typescript
type InstagramEditorSlide = {
  slideIndex: number;
  role: string;
  overlayTexts: Record<string, string>;
  imageFileIds: string[];
  imagePaths: string[];
  imageNames: string[];
};
```

- Update `buildInstagramEditorSeed()` to parse `metadata.slides`.
- If `slides` is missing, synthesize one slide from top-level fields.

#### 3-2. Preview runtime refactor

File: `apps/desktop/src/components/scheduler/instagram/useInstagramPreviewRuntime.ts`

- Replace `imageUrl` with `slideImageUrls`.
- Track `activeSlideIndex`.
- Add:
  - `requestRecomposeSlide(slideIndex, patch?)`
  - `requestRecomposeAll()`
- Compose all slides on initial load with `content:compose-carousel`.
- Persist canonical `slides` metadata, not only top-level fields.

This refactor must happen before UI additions. The current runtime is single-slide stateful and cannot safely support a navigator by incremental prop changes alone.

---

### Phase 4: Desktop editor UI

#### 4-1. Slide navigator component

New file: `apps/desktop/src/components/scheduler/instagram/SlideNavigator.tsx`

- Dot indicators, one per slide
- Left/right arrow buttons
- Slide role label, for example: `Slide 2 / 5 - Problem`
- Props:
  - `slideCount`
  - `activeIndex`
  - `slideRoles`
  - `onChangeIndex`

#### 4-2. Editor component extension

File: `apps/desktop/src/components/scheduler/InstagramContentEditor.tsx`

- State:
  - `slides`
  - `activeSlideIndex`
- Per-slide text edits update only the active slide.
- Per-slide image picker targets the active slide image slots.
- `ImagePreview` shows `slideImageUrls[activeSlideIndex]`.
- Template change triggers recompose of all slides.
- Caption and hashtags remain shared across the full carousel.

#### 4-3. Chat card and lightweight preview compatibility

Files that only expect single-image preview may continue showing slide 0 until dedicated carousel UI is added.

That includes generation result cards that currently consume only top-level fields.

---

### Phase 5: Polish + i18n

- Add slide role translations to desktop locale files.
- Show slide count badge on schedule board cards.
- Handle template-change recompose-all UX.
- Add notices for missing required images on a specific slide.

---

## 7) File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `apps/api/.../types.ts` | Modify | Add slide types, extend draft/result |
| `apps/api/.../prompt.ts` | Modify | Carousel prompt + slide parser |
| `apps/api/.../generate.ts` | Modify | Slide-aware image count and chunking |
| `apps/api/.../persistence.ts` | Modify | Store/load canonical slides |
| `apps/api/.../image-selector.ts` | Modify | Raise required count cap |
| `apps/api/src/routes/contents.ts` | Modify | Slide-aware metadata patch input |
| `apps/api/src/orchestrator/instagram-editor-shared.ts` | Modify | Shared slide normalization helpers |
| `packages/media-engine/.../image-composer.ts` | Modify | Add `composeCarouselImages()` |
| `apps/desktop/electron/main.mjs` | Modify | Slide-aware compose cache and download |
| `apps/desktop/src/global.d.ts` | Modify | Carousel IPC types |
| `apps/desktop/electron/preload.cjs` | Modify | Expose carousel channel |
| `apps/desktop/electron/preload.mjs` | Modify | Expose carousel channel |
| `apps/desktop/.../metadata.ts` | Modify | Parse canonical slides for editor seed |
| `apps/desktop/.../SlideNavigator.tsx` | New | Slide navigation UI |
| `apps/desktop/.../useInstagramPreviewRuntime.ts` | Modify | Multi-slide preview runtime |
| `apps/desktop/.../InstagramContentEditor.tsx` | Modify | Slide navigation and per-slide editing |
| `apps/desktop/src/i18n/locales/en.json` | Modify | Slide role translations |
| `apps/desktop/src/i18n/locales/ko.json` | Modify | Slide role translations |

---

## 8) Verification

1. Prompt parsing tests:
   carousel JSON, single-image JSON, malformed input, edge cases.
2. `normalizeSlides()` tests:
   legacy metadata -> one synthesized slide, carousel metadata -> preserved slide arrays.
3. Generation tests:
   `slideCount * perSlideImageCount` image chunking is correct.
4. Compose tests:
   `composeCarouselImages()` with 3 slides returns 3 buffers.
5. IPC tests:
   `content:compose-carousel` writes `slide-0.png` through `slide-N.png` and refreshes `composed.png`.
6. UI smoke tests:
   navigator is visible, preview switches slides, per-slide edits recompose only the target slide.
7. Backward compatibility:
   existing single-image content loads and edits without regression.
8. End-to-end:
   generate a carousel, open editor, navigate slides, edit text, edit images, download all slides.
