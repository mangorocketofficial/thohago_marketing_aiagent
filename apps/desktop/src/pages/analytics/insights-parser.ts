import type { AccumulatedInsights } from "@repo/types";

export type KeyCountEntry = {
  key: string;
  count: number;
};

/**
 * Check whether the value is a plain object map.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Read an optional string and trim whitespace.
 */
const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * Read a sanitized string array and drop empty values.
 */
const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

/**
 * Read a key-value dictionary where both key and value are non-empty strings.
 */
const readStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = readOptionalString(entry);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    output[normalizedKey] = normalizedValue;
  }
  return output;
};

/**
 * Parse unknown fixture JSON into the shared AccumulatedInsights shape.
 */
export const parseInsightsFixture = (value: unknown): AccumulatedInsights | null => {
  if (!isRecord(value)) {
    return null;
  }

  const generatedAt = readOptionalString(value.generated_at);
  if (!generatedAt) {
    return null;
  }

  const contentCountRaw = value.content_count_at_generation;
  const contentCount =
    typeof contentCountRaw === "number" && Number.isFinite(contentCountRaw)
      ? Math.max(0, Math.floor(contentCountRaw))
      : 0;

  return {
    best_publish_times: readStringRecord(value.best_publish_times),
    top_cta_phrases: readStringArray(value.top_cta_phrases),
    content_pattern_summary: readOptionalString(value.content_pattern_summary) ?? "",
    channel_recommendations: readStringRecord(value.channel_recommendations),
    user_edit_preference_summary: readOptionalString(value.user_edit_preference_summary) ?? "",
    generated_at: generatedAt,
    content_count_at_generation: contentCount
  };
};

/**
 * Extract count pairs from summary text such as "instagram: 25".
 */
export const extractKeyCountEntries = (summary: string): KeyCountEntry[] => {
  const output = new Map<string, number>();
  for (const match of summary.matchAll(/([a-z_]+)\s*:\s*(\d+)/gi)) {
    const key = match[1]?.trim().toLowerCase();
    const count = Number.parseInt(match[2] ?? "", 10);
    if (!key || Number.isNaN(count)) {
      continue;
    }
    output.set(key, count);
  }
  return [...output.entries()].map(([key, count]) => ({ key, count }));
};
