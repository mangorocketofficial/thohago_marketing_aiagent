import type { EnrichedCampaignContext } from "../../rag-context";
import { resolveChannelContentType } from "../../content-type-policy";
import type { CampaignPlan } from "../../types";
import {
  CHAIN_STEP_MAX_TOKENS,
  CHAIN_STEP_TIMEOUT_MS,
  CHAIN_TOTAL_HARD_TIMEOUT_MS,
  buildCompactFactPack,
  buildFullRagContextText,
  buildMicroFactPack,
  buildRepairPrompt,
  buildStepAPrompt,
  buildStepBPrompt,
  buildStepCPrompt,
  buildStepDPrompt,
  extractJsonObject
} from "./chain-steps";
import {
  createDefaultChainStepMeta,
  parseAudienceMessagingData,
  parseChannelStrategyData,
  parseContentCalendarData,
  parseExecutionData,
  type AudienceMessagingData,
  type CampaignPlanChainData,
  type ChainStepMeta,
  type ChainStepName,
  type ChannelStrategyData,
  type ContentCalendarData,
  type ExecutionData
} from "./chain-types";
import {
  buildFallbackAudienceFromPlan,
  buildFallbackCalendarFromPlan,
  buildFallbackChannelStrategyFromPlan
} from "./fallback";

export type CampaignChainModelCallResult = {
  text: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type CampaignChainModelInvoker = (
  prompt: string,
  maxTokens: number
) => Promise<CampaignChainModelCallResult>;

type RunCampaignPlanChainParams = {
  activityFolder: string;
  campaignName?: string | null;
  userMessage: string;
  context: EnrichedCampaignContext;
  invokeModel: CampaignChainModelInvoker;
  revisionReason?: string | null;
  rerunFromStep?: ChainStepName;
  previousChainData?: CampaignPlanChainData | null;
};

type RunCampaignPlanChainResult = {
  chainData: CampaignPlanChainData;
  hardTimeoutExceeded: boolean;
  totalLatencyMs: number;
};

type StepRunSuccess<T> = {
  data: T;
  meta: ChainStepMeta;
};

type StepRunFailure = {
  data: null;
  meta: ChainStepMeta;
};

const CHAIN_VERSION = 1;
const MAX_RETRY = 2;
const STEP_ORDER: ChainStepName[] = ["step_a", "step_b", "step_c", "step_d"];
const STEP_INDEX: Record<ChainStepName, number> = {
  step_a: 0,
  step_b: 1,
  step_c: 2,
  step_d: 3
};

const SCHEMA_SHAPES: Record<ChainStepName, string> = {
  step_a:
    '{"primary_audience":{"label":"string","description":"string","pain_points":["string"],"active_platforms":["string"]},"secondary_audience":{"label":"string","description":"string","pain_points":["string"],"active_platforms":["string"]}|null,"funnel_alignment":{"awareness":"string","consideration":"string","decision":"string"},"core_message":"string","support_messages":[{"message":"string","target_pain_point":"string","evidence":"string"}],"channel_tone_guide":{"channel":"tone"}}',
  step_b:
    '{"owned_channels":[{"channel":"string","rationale":"string","content_format":"string","effort_level":"high|medium|low","key_strategy":"string"}],"earned_channels":[{"channel":"string","rationale":"string","execution":"string","effort_level":"high|medium|low"}],"paid_reference":[{"channel":"string","description":"string","estimated_budget":"string"}]|null}',
  step_c:
    '{"weeks":[{"week_number":1,"theme":"string","phase":"awareness|engagement|conversion","items":[{"day":1,"day_label":"D1","content_title":"string","content_description":"string","channel":"string","format":"string","owner_hint":"string","status":"draft"}]}],"dependencies":[{"source_day":1,"target_day":2,"description":"string"}]}',
  step_d:
    '{"required_assets":[{"id":1,"name":"string","asset_type":"string","description":"string","priority":"must|recommended","deadline_hint":"string"}],"kpi_primary":[{"metric":"string","target":"string","measurement":"string","reporting_cadence":"string"}],"kpi_secondary":[{"metric":"string","target":"string","measurement":"string","reporting_cadence":"string"}],"reporting_plan":{"daily":"string","weekly":"string","post_campaign":"string"},"budget_breakdown":[{"item":"string","estimated_cost":"string","note":"string"}]|null,"risks":[{"risk":"string","likelihood":"high|medium|low","mitigation":"string"}],"next_steps":[{"action":"string","timing":"string"}],"approval_required":["string"]}'
};

const SUPPORTED_CHANNELS = ["instagram", "naver_blog", "facebook", "threads", "youtube"] as const;

const detectSeedChannels = (value: string): string[] => {
  const normalized = value.toLowerCase();
  const channels: string[] = [];
  if (/(instagram|insta)/.test(normalized)) channels.push("instagram");
  if (/(naver[_\s-]?blog|blog)/.test(normalized)) channels.push("naver_blog");
  if (/facebook/.test(normalized)) channels.push("facebook");
  if (/threads/.test(normalized)) channels.push("threads");
  if (/youtube|yt/.test(normalized)) channels.push("youtube");
  return [...new Set(channels)].filter((entry): entry is string => SUPPORTED_CHANNELS.includes(entry as never));
};

const buildSeedPlanForFallback = (params: {
  campaignName: string;
  userMessage: string;
  context: EnrichedCampaignContext;
}): CampaignPlan => {
  const fromInterview = detectSeedChannels(
    `${params.context.interviewAnswers?.q2 ?? ""} ${params.context.interviewAnswers?.q1 ?? ""}`
  );
  const fromUserInput = detectSeedChannels(params.userMessage);
  const channels = [...new Set([...fromUserInput, ...fromInterview])];
  const safeChannels = channels.length > 0 ? channels : ["instagram", "naver_blog", "youtube"];
  const durationDays = 30;
  const postCount = 12;
  const suggestedSchedule = Array.from({ length: postCount }, (_, index) => {
    const ratio = index / Math.max(1, postCount - 1);
    const day = Math.max(1, Math.min(durationDays, Math.round(ratio * (durationDays - 1)) + 1));
    const channel = safeChannels[index % safeChannels.length] ?? "instagram";
    return {
      day,
      channel,
      type: resolveChannelContentType({
        channel,
        sequenceIndex: index
      })
    };
  });

  return {
    objective: `"${params.campaignName}" 캠페인의 핵심 메시지를 명확하게 전달하고 참여를 유도합니다.`,
    channels: safeChannels,
    duration_days: durationDays,
    post_count: postCount,
    content_types: [...new Set(suggestedSchedule.map((entry) => entry.type))],
    suggested_schedule: suggestedSchedule
  };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const runStep = async <T>(params: {
  stepName: ChainStepName;
  schemaName: string;
  basePrompt: string;
  maxTokens: number;
  parse: (value: unknown) => T | null;
  invokeModel: CampaignChainModelInvoker;
  timeoutMs: number;
}): Promise<StepRunSuccess<T> | StepRunFailure> => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let prompt = params.basePrompt;
  let retries = 0;
  let consumedPromptTokens = 0;
  let consumedCompletionTokens = 0;
  let lastErrorCode: string | null = null;
  let lastErrorMessage: string | null = null;
  let lastRawOutput = "";

  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    try {
      const modelResult = await withTimeout(
        params.invokeModel(prompt, params.maxTokens),
        params.timeoutMs,
        `${params.stepName} timed out after ${params.timeoutMs}ms`
      );
      consumedPromptTokens += modelResult.promptTokens ?? 0;
      consumedCompletionTokens += modelResult.completionTokens ?? 0;

      if (!modelResult.text) {
        lastErrorCode = modelResult.errorCode ?? "empty_model_response";
        lastErrorMessage = modelResult.errorMessage ?? "Model returned empty response.";
      } else {
        lastRawOutput = modelResult.text;
        const jsonObjectText = extractJsonObject(modelResult.text);
        if (!jsonObjectText) {
          lastErrorCode = "json_object_not_found";
          lastErrorMessage = "No JSON object detected in model output.";
        } else {
          try {
            const parsed = JSON.parse(jsonObjectText) as unknown;
            const normalized = params.parse(parsed);
            if (normalized) {
              const completedAt = new Date().toISOString();
              return {
                data: normalized,
                meta: {
                  state: "ok",
                  started_at: startedAt,
                  completed_at: completedAt,
                  latency_ms: Math.max(0, Date.now() - startedMs),
                  retry_count: retries,
                  prompt_tokens: consumedPromptTokens || null,
                  completion_tokens: consumedCompletionTokens || null,
                  error_code: null,
                  error_message: null
                }
              };
            }

            lastErrorCode = "schema_validation_failed";
            lastErrorMessage = "Parsed JSON did not satisfy required schema.";
          } catch (error) {
            lastErrorCode = "json_parse_failed";
            lastErrorMessage = error instanceof Error ? error.message : "Unknown JSON parse error.";
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("timed out")) {
        lastErrorCode = "step_timeout";
      } else {
        lastErrorCode = "step_execution_error";
      }
      lastErrorMessage = message;
    }

    if (attempt < MAX_RETRY) {
      retries += 1;
      prompt = buildRepairPrompt({
        schemaName: params.schemaName,
        schemaShape: SCHEMA_SHAPES[params.stepName],
        originalPrompt: params.basePrompt,
        rawOutput: lastRawOutput || lastErrorMessage || "empty"
      });
      continue;
    }
  }

  const completedAt = new Date().toISOString();
  return {
    data: null,
    meta: {
      state: "failed",
      started_at: startedAt,
      completed_at: completedAt,
      latency_ms: Math.max(0, Date.now() - startedMs),
      retry_count: retries,
      prompt_tokens: consumedPromptTokens || null,
      completion_tokens: consumedCompletionTokens || null,
      error_code: lastErrorCode,
      error_message: lastErrorMessage
    }
  };
};

const blockMeta = (reason: string): ChainStepMeta => {
  const base = createDefaultChainStepMeta("blocked_by_dependency");
  return {
    ...base,
    error_message: reason
  };
};

const exceededHardTimeout = (startedMs: number): boolean => Date.now() - startedMs > CHAIN_TOTAL_HARD_TIMEOUT_MS;

const shouldRerunStep = (
  stepName: ChainStepName,
  rerunFromStep: ChainStepName,
  previousChainData: CampaignPlanChainData | null | undefined
): boolean => {
  if (!previousChainData) {
    return true;
  }
  return STEP_INDEX[stepName] >= STEP_INDEX[rerunFromStep];
};

export const runCampaignPlanChain = async (params: RunCampaignPlanChainParams): Promise<RunCampaignPlanChainResult> => {
  const startedMs = Date.now();
  const campaignName = params.campaignName?.trim() || params.activityFolder;
  const rerunFromStep = params.rerunFromStep ?? "step_a";
  const fullRagContext = buildFullRagContextText(params.context);
  const compactFactPack = buildCompactFactPack(params.context);
  const seedPlan = buildSeedPlanForFallback({
    campaignName,
    userMessage: params.userMessage,
    context: params.context
  });

  const previous = params.previousChainData ?? null;
  const previousStepMeta =
    previous && previous.step_meta && typeof previous.step_meta === "object"
      ? (previous.step_meta as Partial<CampaignPlanChainData["step_meta"]>)
      : null;
  const carryStepA = !shouldRerunStep("step_a", rerunFromStep, previous);
  const carryStepB = !shouldRerunStep("step_b", rerunFromStep, previous);
  const carryStepC = !shouldRerunStep("step_c", rerunFromStep, previous);
  const carryStepD = !shouldRerunStep("step_d", rerunFromStep, previous);

  let audience = carryStepA ? previous?.audience ?? null : null;
  let channels = carryStepB ? previous?.channels ?? null : null;
  let calendar = carryStepC ? previous?.calendar ?? null : null;
  let execution = carryStepD ? previous?.execution ?? null : null;

  const stepMeta: CampaignPlanChainData["step_meta"] = {
    step_a: carryStepA
      ? previousStepMeta?.step_a ?? createDefaultChainStepMeta(audience ? "ok" : "failed")
      : createDefaultChainStepMeta("failed"),
    step_b: carryStepB
      ? previousStepMeta?.step_b ?? createDefaultChainStepMeta(channels ? "ok" : "failed")
      : createDefaultChainStepMeta("failed"),
    step_c: carryStepC
      ? previousStepMeta?.step_c ?? createDefaultChainStepMeta(calendar ? "ok" : "failed")
      : createDefaultChainStepMeta("failed"),
    step_d: carryStepD
      ? previousStepMeta?.step_d ?? createDefaultChainStepMeta(execution ? "ok" : "failed")
      : createDefaultChainStepMeta("failed")
  };

  const hasChainTimedOut = (): boolean => exceededHardTimeout(startedMs);

  if (!carryStepA) {
    if (hasChainTimedOut()) {
      stepMeta.step_a = {
        ...createDefaultChainStepMeta("failed"),
        error_code: "chain_timeout",
        error_message: "Chain hard timeout reached before Step A."
      };
    } else {
      const stepA = await runStep<AudienceMessagingData>({
        stepName: "step_a",
        schemaName: "AudienceMessagingData",
        basePrompt: buildStepAPrompt({
          activityFolder: params.activityFolder,
          campaignName,
          userMessage: params.userMessage,
          fullRagContext,
          revisionReason: params.revisionReason,
          previousAudience: previous?.audience ?? null
        }),
        maxTokens: CHAIN_STEP_MAX_TOKENS.step_a,
        parse: parseAudienceMessagingData,
        invokeModel: params.invokeModel,
        timeoutMs: CHAIN_STEP_TIMEOUT_MS
      });
      audience = stepA.data;
      stepMeta.step_a = stepA.meta;
    }
  }
  if (!audience) {
    audience = buildFallbackAudienceFromPlan(seedPlan);
  }

  if (!carryStepB) {
    if (hasChainTimedOut()) {
      stepMeta.step_b = {
        ...createDefaultChainStepMeta("failed"),
        error_code: "chain_timeout",
        error_message: "Chain hard timeout reached before Step B."
      };
    } else if (!audience) {
      stepMeta.step_b = blockMeta("Step B blocked because Step A is unavailable.");
    } else {
      const stepB = await runStep<ChannelStrategyData>({
        stepName: "step_b",
        schemaName: "ChannelStrategyData",
        basePrompt: buildStepBPrompt({
          activityFolder: params.activityFolder,
          campaignName,
          userMessage: params.userMessage,
          compactFactPack,
          audience,
          revisionReason: params.revisionReason,
          previousChannels: previous?.channels ?? null
        }),
        maxTokens: CHAIN_STEP_MAX_TOKENS.step_b,
        parse: parseChannelStrategyData,
        invokeModel: params.invokeModel,
        timeoutMs: CHAIN_STEP_TIMEOUT_MS
      });
      channels = stepB.data;
      stepMeta.step_b = stepB.meta;
    }
  }
  if (!channels) {
    channels = buildFallbackChannelStrategyFromPlan(seedPlan);
  }

  if (!carryStepC) {
    if (hasChainTimedOut()) {
      stepMeta.step_c = {
        ...createDefaultChainStepMeta("failed"),
        error_code: "chain_timeout",
        error_message: "Chain hard timeout reached before Step C."
      };
    } else if (!audience || !channels) {
      stepMeta.step_c = blockMeta("Step C blocked because Step A or Step B is unavailable.");
    } else {
      const microFactPack = buildMicroFactPack({
        context: params.context,
        audience,
        channels
      });
      const stepC = await runStep<ContentCalendarData>({
        stepName: "step_c",
        schemaName: "ContentCalendarData",
        basePrompt: buildStepCPrompt({
          activityFolder: params.activityFolder,
          campaignName,
          userMessage: params.userMessage,
          audience,
          channels,
          microFactPack,
          revisionReason: params.revisionReason,
          previousCalendar: previous?.calendar ?? null
        }),
        maxTokens: CHAIN_STEP_MAX_TOKENS.step_c,
        parse: parseContentCalendarData,
        invokeModel: params.invokeModel,
        timeoutMs: CHAIN_STEP_TIMEOUT_MS
      });
      calendar = stepC.data;
      stepMeta.step_c = stepC.meta;
    }
  }
  if (!calendar) {
    calendar = buildFallbackCalendarFromPlan(seedPlan);
  }

  if (!carryStepD) {
    if (hasChainTimedOut()) {
      stepMeta.step_d = {
        ...createDefaultChainStepMeta("failed"),
        error_code: "chain_timeout",
        error_message: "Chain hard timeout reached before Step D."
      };
    } else if (!audience || !channels || !calendar) {
      stepMeta.step_d = blockMeta("Step D blocked because Step A, Step B, or Step C is unavailable.");
    } else {
      const microFactPack = buildMicroFactPack({
        context: params.context,
        audience,
        channels
      });
      const stepD = await runStep<ExecutionData>({
        stepName: "step_d",
        schemaName: "ExecutionData",
        basePrompt: buildStepDPrompt({
          activityFolder: params.activityFolder,
          campaignName,
          userMessage: params.userMessage,
          audience,
          channels,
          calendar,
          microFactPack,
          revisionReason: params.revisionReason,
          previousExecution: previous?.execution ?? null
        }),
        maxTokens: CHAIN_STEP_MAX_TOKENS.step_d,
        parse: parseExecutionData,
        invokeModel: params.invokeModel,
        timeoutMs: CHAIN_STEP_TIMEOUT_MS
      });
      execution = stepD.data;
      stepMeta.step_d = stepD.meta;
    }
  }

  const chainData: CampaignPlanChainData = {
    audience,
    channels,
    calendar,
    execution,
    generated_at: new Date().toISOString(),
    chain_version: CHAIN_VERSION,
    context_policy: {
      step_a: "full_rag",
      step_b: "compact_fact_pack",
      step_c: "micro_fact_pack",
      step_d: "micro_fact_pack"
    },
    step_meta: stepMeta
  };

  return {
    chainData,
    hardTimeoutExceeded: exceededHardTimeout(startedMs),
    totalLatencyMs: Math.max(0, Date.now() - startedMs)
  };
};

export const getStepDependencyRange = (step: ChainStepName): ChainStepName[] => {
  const index = STEP_INDEX[step];
  return STEP_ORDER.slice(index);
};
