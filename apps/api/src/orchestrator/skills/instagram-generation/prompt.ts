import { truncateToTokenBudget } from "@repo/rag";
import type { InstagramDraft } from "./types";

export type InstagramCaptionContext = {
  brandProfile: string;
  activityFiles: string;
  conversationMemory: string;
  campaignContext: string | null;
  topic: string;
  channel: "instagram";
  templateId: string;
};

const REFERENCE_BUDGET = 2200;

/**
 * Build generation prompt for instagram caption + overlay text JSON.
 */
export const buildInstagramPrompt = (context: InstagramCaptionContext): string => {
  const references = truncateToTokenBudget(
    [
      "[Activity Files]",
      context.activityFiles,
      context.campaignContext ? "[Campaign Context]" : "",
      context.campaignContext ?? ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    REFERENCE_BUDGET
  );

  return [
    "[ROLE]",
    "You are an Instagram content specialist for Korean organizations.",
    "",
    "[BRAND_CONTEXT]",
    context.brandProfile,
    "",
    "[TOPIC]",
    context.topic,
    "",
    "[CONVERSATION_MEMORY]",
    context.conversationMemory,
    "",
    "[CAPTION_GUIDELINES]",
    "- Write Korean caption for Instagram feed post.",
    "- Length: 150-500 Korean characters.",
    "- First line must hook the reader.",
    "- Add line breaks for readability.",
    "- End with a CTA sentence.",
    "- Hashtags: 10-20 relevant tags.",
    "- Use emoji naturally (2-4 max).",
    "",
    "[OVERLAY_TEXT]",
    "- overlay_main: one line, max 15 chars",
    "- overlay_sub: one line, max 25 chars",
    "",
    "[REFERENCE_MATERIALS]",
    references || "(No additional references)",
    "",
    "[OUTPUT_FORMAT]",
    "Return strict JSON only:",
    "{",
    '  "caption": "...",',
    '  "hashtags": ["태그1", "태그2"],',
    '  "overlay_main": "...",',
    '  "overlay_sub": "...",',
    '  "suggested_image_keywords": ["키워드1", "키워드2"]',
    "}"
  ].join("\n");
};

/**
 * Parse model response into normalized draft data.
 */
export const parseInstagramDraft = (text: string): InstagramDraft => {
  const parsed = tryParseJsonObject(text);
  const caption = readString(parsed?.caption).trim();
  const hashtags = normalizeHashtags(parsed?.hashtags, caption);
  const overlayMain = clampText(readString(parsed?.overlay_main).trim(), 15);
  const overlaySub = clampText(readString(parsed?.overlay_sub).trim(), 25);
  const suggestedImageKeywords = normalizeStringArray(parsed?.suggested_image_keywords).slice(0, 6);

  return {
    caption: caption || text.trim(),
    hashtags,
    overlayMain: overlayMain || "지금 확인하세요",
    overlaySub: overlaySub || "함께 참여해보세요",
    suggestedImageKeywords
  };
};

const tryParseJsonObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const direct = JSON.parse(trimmed);
    return direct && typeof direct === "object" && !Array.isArray(direct) ? (direct as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const sliced = JSON.parse(trimmed.slice(start, end + 1));
      return sliced && typeof sliced === "object" && !Array.isArray(sliced)
        ? (sliced as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
};

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

const normalizeHashtags = (value: unknown, caption: string): string[] => {
  const fromArray = normalizeStringArray(value).map((entry) => (entry.startsWith("#") ? entry : `#${entry}`));
  if (fromArray.length) {
    return [...new Set(fromArray)].slice(0, 20);
  }

  const extracted = caption.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(extracted)].slice(0, 20);
};

const clampText = (value: string, maxLength: number): string => {
  if (!value) {
    return "";
  }
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd();
};
