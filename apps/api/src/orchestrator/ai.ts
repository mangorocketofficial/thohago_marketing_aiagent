import { truncateToTokenBudget } from "@repo/rag";
import { env } from "../lib/env";
import { getSessionRollingSummaryText, loadWorkingMemoryForSession, refreshSessionMemorySnapshot } from "./conversation-memory";
import { buildLlmRequestHash, readLlmResponseCache, writeLlmResponseCache } from "./llm-cache";
import { callOpenAi, callWithFallback, isAnthropicCreditExhaustedError } from "./llm-client";
import { buildPreferenceContextText } from "./preference-memory";
import { buildContentGenerationContext, buildEnrichedCampaignContext } from "./rag-context";
import { buildContentTypesForChannels, resolveChannelContentType } from "./content-type-policy";
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
import {
  applyCampaignPlanPreferences,
  buildFallbackAudienceFromPlan,
  buildFallbackCalendarFromPlan,
  buildFallbackChannelStrategyFromPlan,
  buildFallbackExecutionFromPlan,
  normalizePreferredChannels,
  resolveDurationDaysFromText
} from "./skills/campaign-plan/fallback";
import type { CampaignPlan, RagContextMeta, SurveyQuestionId } from "./types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_GENERAL_CHAT_MODEL = "gpt-4o-mini";
const SUPPORTED_CONTENT_CHANNELS = new Set(["instagram", "threads", "naver_blog", "facebook", "youtube"]);
const CHAIN_TARGET_LATENCY_MS = 60_000;

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
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
    const channel = normalizeChannel(item.channel ?? channels[0]);
    return {
      day: parseIntSafe(item.day, index + 1),
      channel,
      type: resolveChannelContentType({
        channel,
        suggestedType: normalizeString(item.type, ""),
        sequenceIndex: index
      })
    };
  });

  const explicitTypes =
    Array.isArray(row.content_types) && row.content_types.length > 0
      ? row.content_types
          .map((entry) => normalizeString(entry, "").toLowerCase())
          .filter((entry) => entry === "text" || entry === "image" || entry === "video")
      : [];
  const scheduleTypes = [...new Set(suggestedSchedule.map((entry) => entry.type.toLowerCase()))];
  const channelPolicyTypes = buildContentTypesForChannels(channels);
  const mergedContentTypes = [...new Set([...explicitTypes, ...scheduleTypes, ...channelPolicyTypes])];

  return {
    objective: normalizeString(
      row.objective,
      `"${activityFolder}"의 성과를 전달하고 참여를 유도합니다.`
    ),
    channels,
    duration_days: parseIntSafe(row.duration_days, 7),
    post_count: parseIntSafe(row.post_count, 3),
    content_types: mergedContentTypes.length > 0 ? mergedContentTypes : ["text"],
    suggested_schedule: suggestedSchedule
  };
};

const fallbackPlan = (activityFolder: string, campaignName?: string | null): CampaignPlan => {
  const planName = normalizeString(campaignName, activityFolder);
  return normalizePlan(
    {
      objective: `"${planName}"의 검증된 소식을 명확한 스토리텔링으로 전달합니다.`,
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
};

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
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    cache?: {
      orgId: string;
      scope: string;
      payload: unknown;
      ttlSeconds?: number;
    };
  }
): Promise<string | null> => {
  if (!env.openAiApiKey) {
    return null;
  }

  const temperature =
    typeof options?.temperature === "number" && Number.isFinite(options.temperature)
      ? Math.max(0, Math.min(2, options.temperature))
      : 0.7;
  const maxTokens =
    typeof options?.maxTokens === "number" && Number.isFinite(options.maxTokens) && options.maxTokens > 0
      ? Math.floor(options.maxTokens)
      : null;

  let cacheKey: string | null = null;
  let requestHash: string | null = null;
  if (options?.cache?.orgId && options.cache.scope) {
    requestHash = buildLlmRequestHash({
      provider: "openai",
      model: OPENAI_GENERAL_CHAT_MODEL,
      scope: options.cache.scope,
      request: options.cache.payload
    });
    cacheKey = buildLlmRequestHash({
      provider: "openai",
      org_id: options.cache.orgId,
      scope: options.cache.scope,
      request_hash: requestHash
    });

    const cached = await readLlmResponseCache({
      orgId: options.cache.orgId,
      cacheKey
    });
    if (cached?.text) {
      return cached.text;
    }
  }

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
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
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
    const text = content.trim();

    if (options?.cache?.orgId && cacheKey && requestHash) {
      await writeLlmResponseCache({
        orgId: options.cache.orgId,
        provider: "openai",
        model: OPENAI_GENERAL_CHAT_MODEL,
        cacheKey,
        requestHash,
        responseText: text,
        promptTokens:
          typeof body.usage?.prompt_tokens === "number" && Number.isFinite(body.usage.prompt_tokens)
            ? body.usage.prompt_tokens
            : null,
        completionTokens:
          typeof body.usage?.completion_tokens === "number" && Number.isFinite(body.usage.completion_tokens)
            ? body.usage.completion_tokens
            : null,
        ttlSeconds: options.cache.ttlSeconds
      });
    }

    return text;
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

export const detectSkillIntentForRouting = async (params: {
  orgId: string;
  sessionId: string;
  currentStep: string;
  userMessage: string;
  availableSkills: Array<{ id: string; description: string }>;
  preferredSkillId?: string | null;
}): Promise<{ skillId: string; confidence: number; reason: string } | null> => {
  const userMessage = String(params.userMessage ?? "").trim();
  if (!userMessage) {
    return null;
  }

  const supportedSkills = params.availableSkills
    .map((entry) => ({
      id: String(entry.id ?? "").trim(),
      description: String(entry.description ?? "").trim()
    }))
    .filter((entry) => entry.id);
  if (supportedSkills.length === 0) {
    return null;
  }
  const preferredSkillId = normalizeString(params.preferredSkillId, "");
  const skillIds = supportedSkills.map((entry) => entry.id);

  const response = await callOpenAiGeneralChat(
    [
      {
        role: "system",
        content: [
          "You classify whether a user message should enter a skill mode.",
          "Return JSON only.",
          "If uncertain, choose none.",
          "If preferred_skill_hint is provided, treat it as user-selected candidate, but still choose none unless the message is actionable enough.",
          "For skills that include 'generation' in id, require a concrete topic/subject in user message.",
          "Generic requests like '블로그 글 써줘' or '글 작성해줘' without a specific topic should be none.",
          `skill_id must be one of: ${skillIds.join(", ")}, none.`,
          'Output schema: {"skill_id":"<skill_id|none>","confidence":0..1,"reason":"short"}'
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `[current_step] ${params.currentStep}`,
          `[preferred_skill_hint] ${preferredSkillId || "none"}`,
          `[available_skills] ${safeJson(supportedSkills)}`,
          `[user_message] ${userMessage}`
        ].join("\n")
      }
    ],
    {
      temperature: 0,
      maxTokens: 120,
      cache: {
        orgId: params.orgId,
        scope: "skill_intent_router",
        payload: {
          session_id: params.sessionId,
          current_step: params.currentStep,
          preferred_skill_hint: preferredSkillId || null,
          available_skills: supportedSkills,
          user_message: userMessage
        },
        ttlSeconds: env.llmResponseCacheTtlSeconds
      }
    }
  );

  if (!response) {
    return null;
  }

  const parsed = parseLooseJsonObject(response);
  if (!parsed) {
    return null;
  }

  const skillId = typeof parsed.skill_id === "string" ? parsed.skill_id.trim().toLowerCase() : "";
  if (!skillId || skillId === "none" || !supportedSkills.some((entry) => entry.id === skillId)) {
    return null;
  }

  const confidenceRaw =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : typeof parsed.confidence === "string"
        ? Number.parseFloat(parsed.confidence)
        : Number.NaN;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "llm_skill_intent";

  return {
    skillId,
    confidence,
    reason
  };
};

const mapSurveyChoiceValue = (raw: string, choices: string[]): string | null => {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  for (const choice of choices) {
    if (choice.trim().toLowerCase() === normalized) {
      return choice;
    }
  }
  return null;
};

const normalizeSurveyClassifierAnswer = (
  questionId: SurveyQuestionId,
  rawAnswer: string,
  choices: string[]
): string | null => {
  const trimmed = rawAnswer.trim();
  if (!trimmed) {
    return null;
  }

  const directChoice = mapSurveyChoiceValue("직접 입력", choices);
  const canonicalChoices = directChoice ? choices.filter((entry) => entry !== directChoice) : [...choices];
  const exactChoice = mapSurveyChoiceValue(trimmed, canonicalChoices);
  if (exactChoice) {
    return exactChoice;
  }

  if (questionId === "channels") {
    const normalized = trimmed.toLowerCase();
    const matched = canonicalChoices.filter((choice) => normalized.includes(choice.toLowerCase()));
    if (matched.length > 0) {
      return [...new Set(matched)].join(", ");
    }
    return trimmed;
  }

  if (questionId === "content_source") {
    const normalized = trimmed.toLowerCase();
    if (/없음|없어|none|no/.test(normalized)) {
      return "없음";
    }
    if (/일부|조금|partial|some/.test(normalized)) {
      return "일부 있음";
    }
    if (/있음|있어|have|has|available/.test(normalized)) {
      return "있음";
    }
  }

  return trimmed;
};

export const classifyCampaignSurveyDirectInput = async (params: {
  questionId: SurveyQuestionId;
  userMessage: string;
  choices: string[];
  suggestedValue: string | null;
  answeredSoFar?: Array<{ question_id: SurveyQuestionId; answer: string }>;
}): Promise<{ answer: string; confidence: number; reason: string } | null> => {
  const userMessage = String(params.userMessage ?? "").trim();
  if (!userMessage) {
    return null;
  }

  const response = await callOpenAiGeneralChat(
    [
      {
        role: "system",
        content: [
          "You map a direct-input survey answer to a campaign planning survey value.",
          "Return JSON only.",
          "If a choice clearly matches, return that canonical choice.",
          "If no choice matches but input is still valid, return a concise normalized answer.",
          "Never return the literal '직접 입력'.",
          'Output schema: {"answer":"string","confidence":0..1,"reason":"short"}'
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `[question_id] ${params.questionId}`,
          `[choices] ${safeJson(params.choices ?? [])}`,
          `[suggested_value] ${params.suggestedValue ?? "none"}`,
          `[answered_so_far] ${safeJson(params.answeredSoFar ?? [])}`,
          `[user_input] ${userMessage}`
        ].join("\n")
      }
    ],
    {
      temperature: 0,
      maxTokens: 140
    }
  );

  if (!response) {
    return null;
  }

  const parsed = parseLooseJsonObject(response);
  if (!parsed) {
    return null;
  }

  const answerRaw = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const normalizedAnswer = normalizeSurveyClassifierAnswer(params.questionId, answerRaw, params.choices ?? []);
  if (!normalizedAnswer) {
    return null;
  }

  const confidenceRaw =
    typeof parsed.confidence === "number"
      ? parsed.confidence
      : typeof parsed.confidence === "string"
        ? Number.parseFloat(parsed.confidence)
        : Number.NaN;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  if (confidence < 0.7) {
    return null;
  }

  const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "llm_survey_mapper";
  return {
    answer: normalizedAnswer,
    confidence,
    reason
  };
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
    campaignName?: string | null;
    preferredDurationDays?: number | null;
    preferredChannels?: string[] | null;
  }
): Promise<{
  plan: CampaignPlan;
  ragMeta: RagContextMeta;
  chainData: CampaignPlanChainData | null;
  planDocument: string | null;
}> => {
  const ctx = await buildEnrichedCampaignContext(orgId, { activityFolder });
  let shouldForceOpenAiFallback = false;
  const preferredDurationDays =
    typeof options?.preferredDurationDays === "number" && Number.isFinite(options.preferredDurationDays)
      ? options.preferredDurationDays
      : resolveDurationDaysFromText(userMessage);
  const preferredChannels = normalizePreferredChannels(options?.preferredChannels);
  const planTitle = normalizeString(
    options?.campaignName,
    normalizeString(options?.orgName, activityFolder || "Organization")
  );

  const invokeCampaignChainModel = async (
    prompt: string,
    tokens: number
  ): Promise<CampaignChainModelCallResult> => {
    if (shouldForceOpenAiFallback) {
      return callOpenAi({
        prompt,
        maxTokens: tokens,
        temperature: 0,
        orgId
      });
    }

    const result = await callWithFallback({
      prompt,
      maxTokens: tokens,
      temperature: 0,
      orgId,
      onFallback: (anthropicResult) => {
        if (isAnthropicCreditExhaustedError(anthropicResult)) {
          shouldForceOpenAiFallback = true;
          console.warn("[CAMPAIGN_CHAIN] Anthropic credits unavailable; falling back to OpenAI gpt-4o-mini.");
        } else {
          console.warn(
            `[CAMPAIGN_CHAIN] Anthropic fallback triggered (${anthropicResult.errorCode ?? "unknown"}): ${
              anthropicResult.errorMessage ?? "no_message"
            }`
          );
        }
      }
    });

    return result;
  };

  try {
    const chain = await runCampaignPlanChain({
      activityFolder,
      campaignName: options?.campaignName ?? null,
      userMessage,
      context: ctx,
      invokeModel: invokeCampaignChainModel,
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

    const fallback = options?.previousPlan
      ? normalizePlan(options.previousPlan, activityFolder)
      : fallbackPlan(activityFolder, options?.campaignName);
    const derivedPlan = buildLegacyPlanFields(activityFolder, options?.campaignName ?? null, chain.chainData);
    const basePlan = hasStructuredOutput ? normalizePlan(derivedPlan, activityFolder) : fallback;
    const calendarAvailable = !!chain.chainData.calendar && chain.chainData.step_meta.step_c.state === "ok";
    const plan = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays,
      preferredChannels,
      calendarAvailable
    });
    const audienceForDocument = chain.chainData.audience ?? buildFallbackAudienceFromPlan(plan);
    const channelsForDocument = chain.chainData.channels ?? buildFallbackChannelStrategyFromPlan(plan);
    const calendarForDocument = chain.chainData.calendar ?? buildFallbackCalendarFromPlan(plan);
    const executionForDocument = chain.chainData.execution ?? buildFallbackExecutionFromPlan(plan);

    const planDocument = assembleCampaignPlanDocument({
      plan,
      audience: audienceForDocument,
      channels: channelsForDocument,
      calendar: calendarForDocument,
      execution: executionForDocument,
      orgName: planTitle,
      generatedAt: chain.chainData.generated_at
    });

    return {
      plan,
      ragMeta: ctx.meta,
      chainData: chain.chainData,
      planDocument
    };
  } catch (error) {
    console.error("[CAMPAIGN_CHAIN] Failed to run campaign chain:", error);
    const basePlan = options?.previousPlan
      ? normalizePlan(options.previousPlan, activityFolder)
      : fallbackPlan(activityFolder, options?.campaignName);
    const plan = applyCampaignPlanPreferences(basePlan, {
      preferredDurationDays,
      preferredChannels,
      calendarAvailable: false
    });
    const audienceForDocument = buildFallbackAudienceFromPlan(plan);
    const channelsForDocument = buildFallbackChannelStrategyFromPlan(plan);
    const planDocument = assembleCampaignPlanDocument({
      plan,
      audience: audienceForDocument,
      channels: channelsForDocument,
      calendar: buildFallbackCalendarFromPlan(plan),
      execution: buildFallbackExecutionFromPlan(plan),
      orgName: planTitle,
      generatedAt: new Date().toISOString()
    });

    return {
      plan,
      ragMeta: ctx.meta,
      chainData: null,
      planDocument
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
  const response = await callWithFallback({
    prompt: promptParts.filter(Boolean).join("\n"),
    maxTokens,
    orgId
  });

  if (response.text) {
    return { draft: response.text, ragMeta: ctx.meta };
  }

  return {
    draft: fallbackDraft(activityFolder),
    ragMeta: ctx.meta
  };
};

export const generateGeneralAssistantReply = async (params: {
  orgId: string;
  sessionId: string;
  userId?: string | null;
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

  await refreshSessionMemorySnapshot({
    orgId: params.orgId,
    sessionId: params.sessionId
  });

  const [workingMemory, rollingSummary, preferenceContext] = await Promise.all([
    loadWorkingMemoryForSession({
      orgId: params.orgId,
      sessionId: params.sessionId,
      currentUserMessage: params.userMessage
    }),
    getSessionRollingSummaryText({
      orgId: params.orgId,
      sessionId: params.sessionId
    }),
    buildPreferenceContextText({
      orgId: params.orgId,
      userId: params.userId ?? null,
      maxItems: env.preferenceMemoryMaxItems
    })
  ]);

  const contextSections = [`[workspace_context]\n${contextNote}`];
  if (rollingSummary) {
    contextSections.push(`[session_summary]\n${truncateToTokenBudget(rollingSummary, env.sessionSummaryTokenBudget)}`);
  }
  if (preferenceContext) {
    contextSections.push(`[long_term_preferences]\n${truncateToTokenBudget(preferenceContext, 180)}`);
  }

  const promptMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "system", content: contextSections.join("\n\n") },
    ...workingMemory.messages
  ];
  if (!workingMemory.includesCurrentUserMessage) {
    promptMessages.push({
      role: "user",
      content: params.userMessage
    });
  }

  const response = await callOpenAiGeneralChat(promptMessages, {
    cache: {
      orgId: params.orgId,
      scope: "general_assistant_reply",
      payload: {
        session_id: params.sessionId,
        step: params.currentStep,
        prompt_messages: promptMessages
      },
      ttlSeconds: env.llmResponseCacheTtlSeconds
    }
  });
  if (response) {
    return response;
  }

  return "메시지는 확인했어요. 대화는 계속 진행할 수 있어요. 다만 현재 대기 중인 콘텐츠 승인 항목은 Inbox에서 승인/수정요청/거절 처리가 필요합니다.";
};
