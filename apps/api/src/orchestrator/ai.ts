import { env } from "../lib/env";
import { buildCampaignPlanContext, buildContentGenerationContext } from "./rag-context";
import type { CampaignPlan, RagContextMeta } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SUPPORTED_CONTENT_CHANNELS = new Set(["instagram", "threads", "naver_blog", "facebook", "youtube"]);

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

const fallbackDraft = (activityFolder: string): string =>
  `${activityFolder} 현장에서 만난 변화의 순간을 전합니다. 여러분의 관심이 다음 활동을 가능하게 만듭니다. 함께 응원해 주세요. #국제개발 #현장소식 #함께하는변화`;

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

export const generateDetectMessage = async (activityFolder: string, fileName: string): Promise<string> => {
  const prompt = [
    `새 활동 폴더 "${activityFolder}"가 감지되었고 파일 "${fileName}"가 추가되었습니다.`,
    "한국어로 2-3문장 안내 메시지를 작성하세요.",
    "사용자에게 이번 활동으로 마케팅 캠페인을 시작할지 물어보세요."
  ].join("\n");

  const response = await callAnthropic(prompt, 240);
  if (response) {
    return response;
  }

  return `"${activityFolder}" 폴더가 새로 감지되었습니다. 첫 파일은 "${fileName}"입니다. 이번 활동으로 마케팅 캠페인을 시작할까요?`;
};

export const generateCampaignPlan = async (
  orgId: string,
  activityFolder: string,
  userMessage: string
): Promise<{ plan: CampaignPlan; ragMeta: RagContextMeta }> => {
  const ctx = await buildCampaignPlanContext(orgId);

  const promptParts: string[] = [
    "당신은 한국 비영리 조직의 마케팅 전략가입니다.",
    "반드시 JSON 객체만 출력하세요."
  ];

  if (ctx.memoryMd) {
    promptParts.push("=== 조직 컨텍스트(memory.md) ===", ctx.memoryMd, "");
  }

  promptParts.push(
    "=== 작업 ===",
    `활동 폴더: \"${activityFolder}\"`,
    `사용자 요청: \"${userMessage}\"`,
    "브랜드 톤/금지 항목/대상 오디언스를 반영한 캠페인 계획을 작성하세요.",
    "",
    "JSON 스키마:",
    "{",
    '  "objective": string,',
    '  "channels": string[],',
    '  "duration_days": number,',
    '  "post_count": number,',
    '  "content_types": string[],',
    '  "suggested_schedule": [{ "day": number, "channel": string, "type": string }]',
    "}"
  );

  const response = await callAnthropic(promptParts.filter(Boolean).join("\n"), 500);
  if (!response) {
    return { plan: fallbackPlan(activityFolder), ragMeta: ctx.meta };
  }

  const jsonText = extractJsonObject(response);
  if (!jsonText) {
    return { plan: fallbackPlan(activityFolder), ragMeta: ctx.meta };
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return { plan: normalizePlan(parsed, activityFolder), ragMeta: ctx.meta };
  } catch {
    return { plan: fallbackPlan(activityFolder), ragMeta: ctx.meta };
  }
};

export const generateContentDraft = async (
  orgId: string,
  activityFolder: string,
  channel: string,
  topic: string
): Promise<{ draft: string; ragMeta: RagContextMeta }> => {
  const normalizedChannel = normalizeChannel(channel);
  const normalizedTopic = normalizeString(topic, activityFolder);
  const ctx = await buildContentGenerationContext(orgId, normalizedChannel, normalizedTopic, activityFolder);

  const promptParts: string[] = [
    "당신은 한국 비영리 조직의 마케팅 카피라이터입니다.",
    "출력은 본문 초안만 작성하세요."
  ];

  if (ctx.memoryMd) {
    promptParts.push("=== 조직 컨텍스트(memory.md) ===", ctx.memoryMd, "");
  }

  if (ctx.tier2Sections) {
    promptParts.push(ctx.tier2Sections, "");
  }

  promptParts.push(
    "=== 작업 ===",
    `채널: ${normalizedChannel}`,
    `활동: ${activityFolder}`,
    `주제: ${normalizedTopic}`,
    "조직 컨텍스트와 참고 자료를 반영해 톤 일관성을 유지하세요.",
    "금지 단어/금지 주제를 절대 사용하지 마세요.",
    ""
  );

  switch (normalizedChannel) {
    case "instagram":
      promptParts.push("- 한국어, 최대 220자, 해시태그 3-5개");
      break;
    case "naver_blog":
      promptParts.push("- 한국어, 블로그 문체, 제목 포함, 800-1500자");
      break;
    case "facebook":
      promptParts.push("- 한국어, 최대 500자, 공유 유도 CTA 포함");
      break;
    case "youtube":
      promptParts.push("- 한국어, 영상 설명문 스타일, 핵심 CTA 포함");
      break;
    default:
      promptParts.push("- 한국어, 최대 300자");
      break;
  }

  const maxTokens = normalizedChannel === "naver_blog" ? 1000 : 400;
  const response = await callAnthropic(promptParts.filter(Boolean).join("\n"), maxTokens);

  if (response) {
    return { draft: response, ragMeta: ctx.meta };
  }

  return {
    draft: fallbackDraft(activityFolder),
    ragMeta: ctx.meta
  };
};
