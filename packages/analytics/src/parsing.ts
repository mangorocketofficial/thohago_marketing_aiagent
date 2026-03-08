import type { AccumulatedInsights } from "@repo/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

const readStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = normalizeString(entry);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    output[normalizedKey] = normalizedValue;
  }
  return output;
};

export const parseAccumulatedInsights = (value: unknown): AccumulatedInsights | null => {
  if (!isRecord(value)) {
    return null;
  }

  const generatedAt = normalizeString(value.generated_at);
  if (!generatedAt) {
    return null;
  }

  return {
    best_publish_times: readStringRecord(value.best_publish_times),
    top_cta_phrases: readStringArray(value.top_cta_phrases),
    content_pattern_summary: normalizeString(value.content_pattern_summary) ?? "",
    channel_recommendations: readStringRecord(value.channel_recommendations),
    user_edit_preference_summary: normalizeString(value.user_edit_preference_summary) ?? "",
    generated_at: generatedAt,
    content_count_at_generation: Math.max(0, Math.floor(readNumber(value.content_count_at_generation) ?? 0))
  };
};
