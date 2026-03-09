import type { InstagramImageMode, InstagramSlideDraft, InstagramSlideRole } from "./types";

const DEFAULT_CAROUSEL_SLIDE_COUNT = 4;
const MIN_CAROUSEL_SLIDE_COUNT = 2;
const MAX_CAROUSEL_SLIDE_COUNT = 10;
const SINGLE_POST_HINTS = [
  "single image",
  "single post",
  "one image",
  "one slide",
  "1slide",
  "1 slide",
  "1post",
  "1 post",
  "1page",
  "1 page",
  "poster only",
  "just one image",
  "한 장",
  "한장",
  "1장",
  "단일 이미지",
  "단일 포스트",
  "포스터만"
];
const DEFAULT_ROLE_SEQUENCE: InstagramSlideRole[] = ["cover", "problem", "solution", "cta"];

const clampText = (value: string, maxLength = 25): string => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trimEnd();
};

const pickFirst = (values: Array<string | undefined>): string => {
  for (const value of values) {
    const normalized = `${value ?? ""}`.trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
};

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clampText(value, 80);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const escapeJson = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');

const buildOverlayExample = (slotIds: string[]): string => {
  if (slotIds.length === 0) {
    return "{}";
  }
  return `{ ${slotIds.map((slotId) => `"${escapeJson(slotId)}": "..."`).join(", ")} }`;
};

const normalizeSlideCount = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CAROUSEL_SLIDE_COUNT;
  }
  return Math.max(MIN_CAROUSEL_SLIDE_COUNT, Math.min(MAX_CAROUSEL_SLIDE_COUNT, Math.floor(value)));
};

const buildRoleSequence = (slideCount: number): InstagramSlideRole[] => {
  if (slideCount <= DEFAULT_ROLE_SEQUENCE.length) {
    return DEFAULT_ROLE_SEQUENCE.slice(0, slideCount);
  }

  const middleCount = Math.max(0, slideCount - 2);
  return ["cover", ...Array.from({ length: middleCount }, (_, index) => (index % 2 === 0 ? "detail" : "benefit")), "cta"];
};

const splitCaptionPoints = (caption: string): string[] => {
  const withoutHashtags = caption
    .split(/\r?\n/)
    .map((line) => line.replace(/#[\p{L}\p{N}_-]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");

  const sentenceParts = withoutHashtags
    .split(/\r?\n|[.!?]|[。！？]|·/u)
    .map((entry) => clampText(entry))
    .filter(Boolean);

  return dedupe(sentenceParts);
};

/**
 * Decide whether generation should backfill a carousel plan when the first draft returns one slide only.
 */
export const shouldBackfillInstagramCarousel = (params: {
  imageMode: InstagramImageMode;
  topic: string;
  caption: string;
  slides?: InstagramSlideDraft[];
}): boolean => {
  if (params.imageMode === "text_only") {
    return false;
  }
  if (Array.isArray(params.slides) && params.slides.length > 1) {
    return false;
  }

  const normalized = `${params.topic}\n${params.caption}`.toLowerCase();
  return !SINGLE_POST_HINTS.some((hint) => normalized.includes(hint));
};

/**
 * Build a focused repair prompt that expands a single-image draft into a fixed-size carousel plan.
 */
export const buildInstagramCarouselExpansionPrompt = (params: {
  topic: string;
  caption: string;
  hashtags: string[];
  overlayTexts: Record<string, string>;
  textSlotIds: string[];
  slideCount?: number;
}): string => {
  const slideCount = normalizeSlideCount(params.slideCount);
  const overlayExample = buildOverlayExample(params.textSlotIds);
  const hashtags = params.hashtags.join(" ");
  const overlayTexts = Object.keys(params.overlayTexts).length > 0 ? JSON.stringify(params.overlayTexts, null, 2) : "{}";

  return [
    "[ROLE]",
    "You repair an Instagram draft that should become a multi-slide carousel.",
    "",
    "[GOAL]",
    `Return strict JSON with exactly ${slideCount} slides.`,
    "- Keep the same topic and overall message.",
    "- Make each slide feel like one step in a coherent carousel flow.",
    "- Slide 1 should be a cover hook and the last slide should be a CTA.",
    "- Use short Korean overlay copy that fits a visual card.",
    "",
    "[INPUT_TOPIC]",
    params.topic,
    "",
    "[INPUT_CAPTION]",
    params.caption,
    "",
    "[INPUT_HASHTAGS]",
    hashtags || "(none)",
    "",
    "[INPUT_OVERLAY_TEXTS]",
    overlayTexts,
    "",
    "[OUTPUT_RULES]",
    "- Return JSON only.",
    `- Include a "slides" array with exactly ${slideCount} items.`,
    '- Each slide must include "role" and "overlay_texts".',
    "- Do not omit slide entries.",
    "- Keep each overlay text value to one short line, max about 25 chars.",
    "",
    "[OUTPUT_EXAMPLE]",
    "{",
    '  "slides": [',
    "    {",
    '      "role": "cover",',
    `      "overlay_texts": ${overlayExample}`,
    "    }",
    "  ]",
    "}"
  ].join("\n");
};

/**
 * Build a deterministic carousel fallback so generation still returns multiple slides when the LLM omits them twice.
 */
export const buildDeterministicCarouselSlides = (params: {
  topic: string;
  caption: string;
  overlayTexts: Record<string, string>;
  slideCount?: number;
}): InstagramSlideDraft[] => {
  const slideCount = normalizeSlideCount(params.slideCount);
  const roles = buildRoleSequence(slideCount);
  const baseTitle = clampText(
    pickFirst([params.overlayTexts.title, params.overlayTexts.headline, params.overlayTexts.main, params.topic]),
    25
  );
  const baseAuthor = clampText(
    pickFirst([params.overlayTexts.author, params.overlayTexts.subtitle, params.overlayTexts.description]),
    25
  );
  const points = dedupe([
    ...splitCaptionPoints(params.caption),
    baseAuthor,
    params.topic,
    "지금 확인해보세요",
    "더 자세한 내용은 캡션에서 확인하세요"
  ]);

  return roles.map((role, index) => {
    if (role === "cover") {
      return {
        role,
        overlayTexts: {
          title: baseTitle || clampText(params.topic, 25) || "지금 확인해보세요",
          author: baseAuthor || points[0] || "핵심 내용을 한눈에 정리했어요"
        }
      };
    }

    if (role === "cta") {
      return {
        role,
        overlayTexts: {
          title: clampText(points[index] || "지금 함께해요", 25),
          author: "더 자세한 내용은 캡션에서 확인하세요"
        }
      };
    }

    const currentPoint = points[index - 1] || points[index] || baseAuthor || baseTitle || "핵심 포인트를 확인해보세요";
    const nextPoint = points[index] || points[index + 1] || baseAuthor || "현장의 변화를 함께 살펴보세요";
    return {
      role,
      overlayTexts: {
        title: clampText(currentPoint, 25),
        author: clampText(nextPoint, 25)
      }
    };
  });
};
