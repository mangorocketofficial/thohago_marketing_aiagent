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
  textSlotIds: string[];
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

  const overlayGuide = buildOverlayGuide(context.textSlotIds);
  const overlayExample = buildOverlayExample(context.textSlotIds);

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
    "- Return overlay_texts as an object.",
    "- Each value must be one line and max 25 chars.",
    "- Keys must exactly match the slot IDs below.",
    overlayGuide,
    "",
    "[REFERENCE_MATERIALS]",
    references || "(No additional references)",
    "",
    "[OUTPUT_FORMAT]",
    "Return strict JSON only:",
    "{",
    '  "caption": "...",',
    '  "hashtags": ["#tag1", "#tag2"],',
    `  "overlay_texts": ${overlayExample},`,
    '  "suggested_image_keywords": ["keyword1", "keyword2"]',
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
  const suggestedImageKeywords = normalizeStringArray(parsed?.suggested_image_keywords).slice(0, 6);

  const overlayTexts = normalizeOverlayTexts(parsed);

  return {
    caption: caption || text.trim(),
    hashtags,
    overlayTexts,
    suggestedImageKeywords
  };
};

const buildOverlayGuide = (slotIds: string[]): string => {
  if (slotIds.length === 0) {
    return "- No text slots provided. Return an empty object.";
  }
  return `- Slot IDs: ${slotIds.join(", ")}`;
};

const buildOverlayExample = (slotIds: string[]): string => {
  if (slotIds.length === 0) {
    return "{}";
  }

  const entries = slotIds.map((slotId) => `"${escapeJson(slotId)}": "..."`);
  return `{ ${entries.join(", ")} }`;
};

const normalizeOverlayTexts = (parsed: Record<string, unknown> | null): Record<string, string> => {
  const fromMap = normalizeStringMap(parsed?.overlay_texts);
  if (Object.keys(fromMap).length > 0) {
    return fromMap;
  }

  return {
    title: "지금 확인하세요",
    author: "함께 참여해보세요"
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

const normalizeStringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const slotId = key.trim();
    if (!slotId) {
      continue;
    }
    const text = clampText(readString(entry).trim(), 25);
    if (!text) {
      continue;
    }
    result[slotId] = text;
  }

  return result;
};

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

const escapeJson = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
