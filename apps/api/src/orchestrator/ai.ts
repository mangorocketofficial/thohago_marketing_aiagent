import { env } from "../lib/env";
import { buildContentGenerationContext, buildEnrichedCampaignContext } from "./rag-context";
import { assembleCampaignPlanDocument } from "./skills/campaign-plan/assembler";
import {
  runCampaignPlanChain,
  type CampaignChainModelCallResult
} from "./skills/campaign-plan/chain";
import {
  buildLegacyPlanFields,
  type CampaignPlanChainData,
  type ChainStepName
} from "./skills/campaign-plan/chain-types";
import type { CampaignPlan, RagContextMeta } from "./types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_GENERAL_CHAT_MODEL = "gpt-4o-mini";
const SUPPORTED_CONTENT_CHANNELS = new Set(["instagram", "threads", "naver_blog", "facebook", "youtube"]);
const CHAIN_TARGET_LATENCY_MS = 30_000;

type AnthropicTextBlock = {
  type?: string;
  text?: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
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
      objective: `Share verified updates from "${activityFolder}" with clear storytelling.`,
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
  `We are sharing a field update from ${activityFolder}. Your support helps us continue this work. #ngo #fieldupdate #impact`;

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
};

const callOpenAiGeneralChat = async (
  messages: Array<{ role: "system" | "user"; content: string }>,
  options?: {
    temperature?: number;
  }
): Promise<string | null> => {
  if (!env.openAiApiKey) {
    return null;
  }

  const temperature =
    typeof options?.temperature === "number" && Number.isFinite(options.temperature)
      ? Math.max(0, Math.min(2, options.temperature))
      : 0.7;

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_GENERAL_CHAT_MODEL,
        temperature,
        messages
      })
    });

    const body = (await response.json().catch(() => ({}))) as OpenAiChatCompletionResponse;
    if (!response.ok) {
      console.error(`[AI] OpenAI general chat failed (${response.status}): ${body.error?.message ?? "unknown"}`);
      return null;
    }

    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return null;
    }
    return content.trim();
  } catch (error) {
    console.error("[AI] OpenAI general chat request error:", error);
    return null;
  }
};

type CampaignDraftReviewIntent = "revision" | "satisfaction" | "confirm" | "discussion";

const parseLooseJsonObject = (value: string): Record<string, unknown> | null => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) {
      return null;
    }
    const candidate = raw.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
};

export const classifyCampaignDraftReviewIntent = async (params: {
  userMessage: string;
  awaitingFinalConfirmation: boolean;
}): Promise<{ intent: CampaignDraftReviewIntent; confidence: number; reason: string } | null> => {
  const userMessage = String(params.userMessage ?? "").trim();
  if (!userMessage) {
    return null;
  }

  const response = await callOpenAiGeneralChat(
    [
      {
        role: "system",
        content: [
          "You classify a user message during campaign draft review.",
          "Return JSON only.",
          "Allowed intents: revision | satisfaction | confirm | discussion.",
          "Definitions:",
          "- revision: asks to change/update/add/remove parts of draft.",
          "- satisfaction: positive feedback but no explicit final approval.",
          "- confirm: explicit final approval/confirmation to proceed.",
          "- discussion: question/comment not requesting revision or approval.",
          "If awaiting_final_confirmation=true, clear positive acceptance should be classified as confirm.",
          'Output schema: {"intent":"revision|satisfaction|confirm|discussion","confidence":0..1,"reason":"short"}'
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `[awaiting_final_confirmation] ${params.awaitingFinalConfirmation ? "true" : "false"}`,
          `[user_message] ${userMessage}`
        ].join("\n")
      }
    ],
    {
      temperature: 0.1
    }
  );

  if (!response) {
    return null;
  }

  const parsed = parseLooseJsonObject(response);
  if (!parsed) {
    return null;
  }

  const intentRaw = typeof parsed.intent === "string" ? parsed.intent.trim().toLowerCase() : "";
  const validIntents = new Set<CampaignDraftReviewIntent>(["revision", "satisfaction", "confirm", "discussion"]);
  if (!validIntents.has(intentRaw as CampaignDraftReviewIntent)) {
    return null;
  }

  const confidenceRaw =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : typeof parsed.confidence === "string"
        ? Number.parseFloat(parsed.confidence)
        : Number.NaN;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  if (confidence < 0.55) {
    return null;
  }

  const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "llm_intent";
  return {
    intent: intentRaw as CampaignDraftReviewIntent,
    confidence,
    reason
  };
};

const callAnthropicWithUsage = async (prompt: string, maxTokens: number): Promise<CampaignChainModelCallResult> => {
  if (!env.anthropicApiKey) {
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "missing_api_key",
      errorMessage: "ANTHROPIC_API_KEY is missing."
    };
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

    const payload = (await response.json().catch(() => ({}))) as AnthropicResponse;
    const promptTokens =
      typeof payload.usage?.input_tokens === "number" && Number.isFinite(payload.usage.input_tokens)
        ? payload.usage.input_tokens
        : null;
    const completionTokens =
      typeof payload.usage?.output_tokens === "number" && Number.isFinite(payload.usage.output_tokens)
        ? payload.usage.output_tokens
        : null;

    if (!response.ok) {
      const errorMessage = payload.error?.message ?? "unknown";
      console.error(`[AI] Anthropic request failed (${response.status}): ${errorMessage}`);
      return {
        text: null,
        promptTokens,
        completionTokens,
        errorCode: `http_${response.status}`,
        errorMessage
      };
    }

    const block = payload.content?.find((entry) => entry.type === "text" && !!entry.text?.trim());
    return {
      text: block?.text?.trim() ?? null,
      promptTokens,
      completionTokens,
      errorCode: null,
      errorMessage: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AI] Anthropic request error:", error);
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "request_error",
      errorMessage: message
    };
  }
};

const callAnthropic = async (prompt: string, maxTokens: number): Promise<string | null> => {
  const result = await callAnthropicWithUsage(prompt, maxTokens);
  return result.text;
};

export const generateCampaignPlan = async (
  orgId: string,
  activityFolder: string,
  userMessage: string,
  options?: {
    previousPlan?: CampaignPlan | null;
    revisionReason?: string | null;
    previousChainData?: CampaignPlanChainData | null;
    rerunFromStep?: ChainStepName;
    orgName?: string | null;
  }
): Promise<{
  plan: CampaignPlan;
  ragMeta: RagContextMeta;
  chainData: CampaignPlanChainData | null;
  planDocument: string | null;
}> => {
  const ctx = await buildEnrichedCampaignContext(orgId, { activityFolder });

  try {
    const chain = await runCampaignPlanChain({
      activityFolder,
      userMessage,
      context: ctx,
      invokeModel: callAnthropicWithUsage,
      revisionReason: options?.revisionReason ?? null,
      previousChainData: options?.previousChainData ?? null,
      rerunFromStep: options?.rerunFromStep
    });

    if (chain.totalLatencyMs > CHAIN_TARGET_LATENCY_MS) {
      console.warn(
        `[CAMPAIGN_CHAIN] Target latency exceeded (${chain.totalLatencyMs}ms > ${CHAIN_TARGET_LATENCY_MS}ms).`
      );
    }

    const hasStructuredOutput =
      !!chain.chainData.audience ||
      !!chain.chainData.channels ||
      !!chain.chainData.calendar ||
      !!chain.chainData.execution;

    const fallback = options?.previousPlan ? normalizePlan(options.previousPlan, activityFolder) : fallbackPlan(activityFolder);
    const derivedPlan = buildLegacyPlanFields(activityFolder, chain.chainData);
    const plan = hasStructuredOutput ? normalizePlan(derivedPlan, activityFolder) : fallback;

    const planDocument = assembleCampaignPlanDocument({
      plan,
      audience: chain.chainData.audience,
      channels: chain.chainData.channels,
      calendar: chain.chainData.calendar,
      execution: chain.chainData.execution,
      orgName: normalizeString(options?.orgName, activityFolder || "Organization"),
      generatedAt: chain.chainData.generated_at,
      chain: chain.chainData
    });

    return {
      plan,
      ragMeta: ctx.meta,
      chainData: chain.chainData,
      planDocument
    };
  } catch (error) {
    console.error("[CAMPAIGN_CHAIN] Failed to run campaign chain:", error);

    return {
      plan: options?.previousPlan ? normalizePlan(options.previousPlan, activityFolder) : fallbackPlan(activityFolder),
      ragMeta: ctx.meta,
      chainData: null,
      planDocument: null
    };
  }
};

export const generateContentDraft = async (
  orgId: string,
  activityFolder: string,
  channel: string,
  topic: string,
  options?: {
    previousDraft?: string | null;
    revisionReason?: string | null;
  }
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

  const revisionReason = normalizeString(options?.revisionReason, "");
  const previousDraft = normalizeString(options?.previousDraft, "");
  if (revisionReason || previousDraft) {
    promptParts.push("=== 리비전 컨텍스트 ===");
    if (revisionReason) {
      promptParts.push(`수정 요청 사유: "${revisionReason}"`);
    }
    if (previousDraft) {
      promptParts.push("이전 초안:", previousDraft);
    }
    promptParts.push("이전 초안을 참고하되 수정 사유를 충족하는 새 본문으로 전체 재작성하세요.", "");
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

export const generateGeneralAssistantReply = async (params: {
  activityFolder: string;
  currentStep: string;
  userMessage: string;
  campaignId?: string | null;
  contentId?: string | null;
}): Promise<string> => {
  const systemPrompt = [
    "You are a helpful marketing AI assistant for a Korean NGO workspace.",
    "Respond naturally and helpfully in Korean.",
    "Keep response concise (2-5 sentences) unless user asks for deep detail.",
    "If content approval is pending, remind user that Inbox actions are still required for workflow progress while continuing normal conversation."
  ].join(" ");

  const pendingState =
    params.currentStep === "await_content_approval" ? "content approval pending" : "normal";
  const contextNote = safeJson({
    activity_folder: params.activityFolder,
    step: params.currentStep,
    pending_state: pendingState,
    campaign_id: params.campaignId ?? null,
    content_id: params.contentId ?? null
  });
  const userPrompt = [`[workspace_context]`, contextNote, `[user_message]`, params.userMessage].join("\n");

  const response = await callOpenAiGeneralChat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);
  if (response) {
    return response;
  }

  return "메시지는 확인했어요. 대화는 계속 진행할 수 있어요. 다만 현재 대기 중인 콘텐츠 승인 항목은 Inbox에서 승인/수정요청/거절 처리가 필요합니다.";
};
