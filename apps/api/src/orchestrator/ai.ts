import { env } from "../lib/env";
import type { CampaignPlan } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SUPPORTED_CONTENT_CHANNELS = new Set([
  "instagram",
  "threads",
  "naver_blog",
  "facebook",
  "youtube"
]);

type AnthropicTextBlock = {
  type?: string;
  text?: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
};

const extractJsonObject = (value: string): string | null => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return value.slice(start, end + 1);
};

const parseIntSafe = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
};

const normalizeChannel = (value: unknown): string => {
  if (typeof value !== "string") {
    return "instagram";
  }
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_CONTENT_CHANNELS.has(normalized) ? normalized : "instagram";
};

const normalizeString = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
};

const normalizePlan = (value: unknown, activityFolder: string): CampaignPlan => {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  const channels =
    Array.isArray(row.channels) && row.channels.length > 0
      ? row.channels.map((entry) => normalizeChannel(entry))
      : ["instagram"];

  const suggestedScheduleRaw = Array.isArray(row.suggested_schedule)
    ? row.suggested_schedule
    : [
        {
          day: 1,
          channel: channels[0],
          type: "text"
        }
      ];

  const suggestedSchedule = suggestedScheduleRaw.map((entry, index) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      day: parseIntSafe(item.day, index + 1),
      channel: normalizeChannel(item.channel ?? channels[0]),
      type: normalizeString(item.type, "text")
    };
  });

  return {
    objective: normalizeString(
      row.objective,
      `Introduce outcomes from "${activityFolder}" and invite audience engagement.`
    ),
    channels,
    duration_days: parseIntSafe(row.duration_days, 7),
    post_count: parseIntSafe(row.post_count, 3),
    content_types:
      Array.isArray(row.content_types) && row.content_types.length > 0
        ? row.content_types.map((entry) => normalizeString(entry, "text"))
        : ["text"],
    suggested_schedule: suggestedSchedule
  };
};

const fallbackPlan = (activityFolder: string): CampaignPlan =>
  normalizePlan(
    {
      objective: `Share field updates from "${activityFolder}" with transparent storytelling.`,
      channels: ["instagram", "threads"],
      duration_days: 7,
      post_count: 3,
      content_types: ["text"],
      suggested_schedule: [
        { day: 1, channel: "instagram", type: "text" },
        { day: 3, channel: "threads", type: "text" },
        { day: 6, channel: "instagram", type: "text" }
      ]
    },
    activityFolder
  );

const callAnthropic = async (prompt: string, maxTokens: number): Promise<string | null> => {
  if (!env.anthropicApiKey) {
    return null;
  }

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.anthropicApiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.anthropicModel,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[AI] Anthropic request failed (${response.status}): ${body}`);
      return null;
    }

    const payload = (await response.json()) as AnthropicResponse;
    const block = payload.content?.find((entry) => entry.type === "text" && !!entry.text?.trim());
    return block?.text?.trim() ?? null;
  } catch (error) {
    console.error("[AI] Anthropic request error:", error);
    return null;
  }
};

export const generateDetectMessage = async (
  activityFolder: string,
  fileName: string
): Promise<string> => {
  const prompt = [
    `A new activity folder "${activityFolder}" was detected with file "${fileName}".`,
    "Write a short, friendly message in Korean (2-3 sentences).",
    "Ask the user whether to start planning a marketing campaign for this activity."
  ].join("\n");

  const response = await callAnthropic(prompt, 240);
  if (response) {
    return response;
  }

  return `"${activityFolder}" 폴더가 새로 감지되었습니다. 첫 파일은 "${fileName}" 입니다. 이 활동으로 마케팅 캠페인을 시작할까요?`;
};

export const generateCampaignPlan = async (
  activityFolder: string,
  userMessage: string
): Promise<CampaignPlan> => {
  const prompt = [
    `Activity folder: "${activityFolder}"`,
    `User preference: "${userMessage}"`,
    "Generate a compact campaign plan as JSON only.",
    "Required schema:",
    "{",
    '  "objective": string,',
    '  "channels": string[],',
    '  "duration_days": number,',
    '  "post_count": number,',
    '  "content_types": string[],',
    '  "suggested_schedule": [{ "day": number, "channel": string, "type": string }]',
    "}"
  ].join("\n");

  const response = await callAnthropic(prompt, 500);
  if (!response) {
    return fallbackPlan(activityFolder);
  }

  const jsonText = extractJsonObject(response);
  if (!jsonText) {
    return fallbackPlan(activityFolder);
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return normalizePlan(parsed, activityFolder);
  } catch {
    return fallbackPlan(activityFolder);
  }
};

export const generateContentDraft = async (
  activityFolder: string,
  channel: string
): Promise<string> => {
  const normalizedChannel = normalizeChannel(channel);
  const prompt = [
    `Write one ${normalizedChannel} post for Korean nonprofit audience.`,
    `Activity: "${activityFolder}"`,
    "Constraints:",
    "- Korean language",
    "- warm, clear tone",
    "- max 220 characters",
    "- include 3 hashtags"
  ].join("\n");

  const response = await callAnthropic(prompt, 240);
  if (response) {
    return response;
  }

  return `${activityFolder} 현장에서 만난 변화의 순간을 전합니다. 여러분의 관심이 다음 활동을 가능하게 만듭니다. 함께 응원해 주세요. #국제개발 #현장소식 #함께하는변화`;
};

