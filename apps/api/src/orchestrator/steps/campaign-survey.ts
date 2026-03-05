import { HttpError } from "../../lib/errors";
import { supabaseAdmin } from "../../lib/supabase-admin";
import { classifyCampaignSurveyDirectInput, generateCampaignPlan } from "../ai";
import { buildEnrichedCampaignContext } from "../rag-context";
import { buildCampaignPlanSummary } from "../service-helpers";
import type { CampaignPlanChainData, ChainStepName } from "../skills/campaign-plan/chain-types";
import {
  SURVEY_QUESTIONS,
  applyAutoFillToPendingOptional,
  buildChainInputFromSurvey,
  buildPendingQuestions,
  buildSurveyAutoFillData,
  buildSurveyPrompt,
  buildSurveyPromptMetadata,
  canEarlyExit,
  extractAnswersFromInitialMessage,
  isEarlyExitIntent,
  isSurveyComplete,
  parseSurveyAnswer
} from "../skills/campaign-plan/survey";
import type { CampaignPlan, CampaignSurveyState, SurveyAnswer, SurveyQuestionId } from "../types";
import type { SkillExecutionContext, SkillResult } from "../skills/types";

type DraftReviewIntentDeps = {
  normalizeMessage: (value: string) => string;
  isRevisionIntent: (normalizedMessage: string) => boolean;
  inferCampaignRerunStep: (normalizedMessage: string) => ChainStepName;
  isSatisfactionSignal: (normalizedMessage: string) => boolean;
  isExplicitConfirmIntent: (normalizedMessage: string) => boolean;
  classifyIntent?: (params: {
    userMessage: string;
    awaitingFinalConfirmation: boolean;
  }) => Promise<{
    intent: "revision" | "satisfaction" | "confirm" | "discussion";
    confidence: number;
    reason: string;
  } | null>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const parseCampaignChainData = (value: unknown): CampaignPlanChainData | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as CampaignPlanChainData) : null;

const readUserMessageFromEvent = (context: SkillExecutionContext): string => {
  const content = context.deps.asString(context.event.payload?.content, "").trim();
  if (!content) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }
  return content;
};

const mergeAnswers = (base: SurveyAnswer[], updates: SurveyAnswer[]): SurveyAnswer[] => {
  const map = new Map<SurveyQuestionId, SurveyAnswer>();
  for (const answer of base) {
    map.set(answer.question_id, answer);
  }
  for (const answer of updates) {
    map.set(answer.question_id, answer);
  }
  return [...map.values()];
};

const buildConfirmationPrompt = (): string => "이 계획을 최종 확정하여 캠페인으로 진행하시겠습니까?";

const isMissingRelationError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "42P01";

const persistCampaignPlanVersion = async (params: {
  orgId: string;
  sessionId: string;
  campaignId?: string;
  draftVersion: number;
  source: "draft_generated" | "revision_generated" | "finalized";
  activityFolder: string;
  userMessage: string | null;
  revisionReason?: string | null;
  plan: CampaignPlan;
  planDocument?: string | null;
  planChainData?: Record<string, unknown> | null;
  createdByUserId?: string | null;
}): Promise<void> => {
  const { error } = await supabaseAdmin.from("campaign_plan_versions").insert({
    org_id: params.orgId,
    session_id: params.sessionId,
    campaign_id: params.campaignId ?? null,
    draft_version: Math.max(1, params.draftVersion),
    source: params.source,
    activity_folder: params.activityFolder,
    user_message: params.userMessage,
    revision_reason: params.revisionReason ?? null,
    plan: params.plan,
    plan_document: params.planDocument ?? null,
    plan_chain_data: params.planChainData ?? null,
    plan_summary: buildCampaignPlanSummary({
      plan: params.plan,
      planChainData: params.planChainData ?? null
    }),
    created_by_user_id: params.createdByUserId ?? null
  });

  if (!error) {
    return;
  }
  if (isMissingRelationError(error)) {
    console.warn("[CAMPAIGN_SURVEY] campaign_plan_versions table is missing; skipping audit persistence.");
    return;
  }
  throw new HttpError(500, "db_error", `Failed to persist campaign plan version: ${error.message}`);
};

const createScheduleSlotsForCampaign = async (params: {
  orgId: string;
  sessionId: string;
  campaignId: string;
  activityFolder: string;
  plan: {
    suggested_schedule?: Array<{ day?: number; channel?: string; type?: string }>;
  };
}): Promise<void> => {
  const schedule = Array.isArray(params.plan.suggested_schedule) ? params.plan.suggested_schedule : [];
  if (schedule.length === 0) {
    return;
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const rows = schedule.map((entry, index) => {
    const dayOffsetRaw = typeof entry.day === "number" && Number.isFinite(entry.day) ? Math.floor(entry.day) : 1;
    const dayOffset = Math.max(1, dayOffsetRaw);
    const slotDate = new Date(start);
    slotDate.setUTCDate(start.getUTCDate() + dayOffset - 1);
    const channel = typeof entry.channel === "string" && entry.channel.trim() ? entry.channel.trim().toLowerCase() : "instagram";
    const title = typeof entry.type === "string" && entry.type.trim() ? entry.type.trim() : `Post ${index + 1}`;

    return {
      org_id: params.orgId,
      campaign_id: params.campaignId,
      session_id: params.sessionId,
      channel,
      content_type: "text",
      title,
      scheduled_date: slotDate.toISOString().slice(0, 10),
      slot_status: "scheduled",
      metadata: {
        activity_folder: params.activityFolder,
        suggested_day: dayOffset,
        suggested_type: title,
        sequence: index + 1
      }
    };
  });

  const { error } = await supabaseAdmin.from("schedule_slots").insert(rows);
  if (!error) {
    return;
  }
  if (isMissingRelationError(error)) {
    console.warn("[CAMPAIGN_SURVEY] schedule_slots table is missing; skipping slot creation.");
    return;
  }
  throw new HttpError(500, "db_error", `Failed to create schedule slots: ${error.message}`);
};

const buildSurveyState = (params: {
  previous?: CampaignSurveyState | null;
  phase: CampaignSurveyState["phase"];
  pendingQuestions: SurveyQuestionId[];
  answers: SurveyAnswer[];
  autoFillApplied: boolean;
  completedAt: string | null;
  awaitingFinalConfirmation: boolean;
}): CampaignSurveyState => ({
  started_at: params.previous?.started_at ?? new Date().toISOString(),
  phase: params.phase,
  pending_questions: params.pendingQuestions,
  answers: params.answers,
  auto_fill_applied: params.previous?.auto_fill_applied === true || params.autoFillApplied,
  completed_at: params.completedAt,
  awaiting_final_confirmation: params.awaitingFinalConfirmation
});

const finalizeCampaignPlan = async (params: {
  context: SkillExecutionContext;
  surveyState: CampaignSurveyState;
}): Promise<SkillResult> => {
  const { context, surveyState } = params;
  if (!context.state.campaign_plan) {
    throw new HttpError(409, "invalid_state", "campaign_plan is required before finalization.");
  }

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("campaigns")
    .insert({
      org_id: context.session.org_id,
      title: `${context.state.activity_folder} Campaign`,
      activity_folder: context.state.activity_folder,
      status: "approved",
      channels: context.state.campaign_plan.channels,
      plan: context.state.campaign_plan,
      plan_chain_data: context.state.campaign_chain_data,
      plan_document: context.state.campaign_plan_document
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    throw new HttpError(500, "db_error", `Failed to create finalized campaign: ${campaignError?.message ?? "unknown"}`);
  }

  const campaignId = context.deps.asString(asRecord(campaign).id, "");
  if (!campaignId) {
    throw new HttpError(500, "db_error", "Failed to resolve finalized campaign id.");
  }

  await createScheduleSlotsForCampaign({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    campaignId,
    activityFolder: context.state.activity_folder,
    plan: context.state.campaign_plan
  });

  await persistCampaignPlanVersion({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    campaignId,
    draftVersion: Math.max(1, context.state.campaign_draft_version || 1),
    source: "finalized",
    activityFolder: context.state.activity_folder,
    userMessage: context.state.user_message,
    plan: context.state.campaign_plan,
    planDocument: context.state.campaign_plan_document,
    planChainData: context.state.campaign_chain_data,
    createdByUserId: context.session.created_by_user_id
  });

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content: "캠페인 계획을 확정했습니다. 다음 단계로 진행하겠습니다."
  });

  return {
    handled: true,
    outcome: "session_done",
    statePatch: {
      campaign_id: campaignId,
      campaign_survey: {
        ...surveyState,
        completed_at: surveyState.completed_at ?? new Date().toISOString(),
        awaiting_final_confirmation: false
      },
      last_error: null
    },
    completion: "none"
  };
};

const generateAndPresentDraft = async (params: {
  context: SkillExecutionContext;
  surveyState: CampaignSurveyState;
  answers: SurveyAnswer[];
  draftVersion: number;
  revisionReason?: string;
  rerunFromStep?: ChainStepName;
}): Promise<SkillResult> => {
  const chainInput = buildChainInputFromSurvey(params.answers);
  const previousChainData = parseCampaignChainData(params.context.state.campaign_chain_data);

  const generated = await generateCampaignPlan(
    params.context.session.org_id,
    params.context.state.activity_folder,
    chainInput,
    {
      previousPlan: params.revisionReason ? params.context.state.campaign_plan : null,
      revisionReason: params.revisionReason ?? null,
      previousChainData: params.revisionReason ? previousChainData : null,
      rerunFromStep: params.rerunFromStep,
      orgName: params.context.state.activity_folder
    }
  );

  await persistCampaignPlanVersion({
    orgId: params.context.session.org_id,
    sessionId: params.context.session.id,
    draftVersion: Math.max(1, params.draftVersion),
    source: params.revisionReason ? "revision_generated" : "draft_generated",
    activityFolder: params.context.state.activity_folder,
    userMessage: params.context.state.user_message,
    revisionReason: params.revisionReason ?? null,
    plan: generated.plan,
    planDocument: generated.planDocument,
    planChainData: generated.chainData ? (generated.chainData as unknown as Record<string, unknown>) : null,
    createdByUserId: params.context.session.created_by_user_id
  });

  const draftHeader =
    params.draftVersion > 1
      ? `수정된 캠페인 계획입니다 (v${params.draftVersion}).`
      : `캠페인 계획 초안입니다 (v${params.draftVersion}).`;
  const draftBody = generated.planDocument?.trim() ? generated.planDocument.trim() : JSON.stringify(generated.plan, null, 2);

  await params.context.deps.campaign.insertChatMessage({
    orgId: params.context.session.org_id,
    sessionId: params.context.session.id,
    role: "assistant",
    content: `${draftHeader}\n\n${draftBody}`,
    metadata: {
      draft_version: params.draftVersion
    }
  });

  await params.context.deps.campaign.insertChatMessage({
    orgId: params.context.session.org_id,
    sessionId: params.context.session.id,
    role: "assistant",
    content: "계획을 검토해 주세요. 수정이 필요하면 말씀해 주시고, 만족하면 알려주세요."
  });

  return {
    handled: true,
    outcome: "no_transition",
    statePatch: {
      campaign_plan: generated.plan,
      campaign_chain_data: generated.chainData ? (generated.chainData as unknown as Record<string, unknown>) : null,
      campaign_plan_document: generated.planDocument,
      campaign_draft_version: params.draftVersion,
      rag_context: generated.ragMeta,
      campaign_survey: buildSurveyState({
        previous: params.surveyState,
        phase: "draft_review",
        pendingQuestions: [],
        answers: params.answers,
        autoFillApplied: false,
        completedAt: params.surveyState.completed_at ?? new Date().toISOString(),
        awaitingFinalConfirmation: false
      }),
      last_error: null
    },
    completion: "none"
  };
};

export const handleSurveyStart = async (context: SkillExecutionContext): Promise<SkillResult> => {
  const content = readUserMessageFromEvent(context);

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    role: "user",
    content
  });

  const ragContext = await buildEnrichedCampaignContext(context.session.org_id, {
    activityFolder: context.state.activity_folder
  });
  const autoFillData = buildSurveyAutoFillData(ragContext);
  const extractedAnswers = await extractAnswersFromInitialMessage(content);
  const pendingQuestions = buildPendingQuestions(SURVEY_QUESTIONS, extractedAnswers);

  let nextAnswers = extractedAnswers;
  let nextPending = pendingQuestions;
  const canSkipToDraft = canEarlyExit({
    answers: extractedAnswers,
    pendingQuestions
  });

  if (canSkipToDraft && pendingQuestions.length > 0) {
    nextAnswers = applyAutoFillToPendingOptional({
      answers: extractedAnswers,
      pendingQuestions,
      autoFillData
    });
    nextPending = [];
  }

  const surveyState = buildSurveyState({
    phase: "survey_active",
    pendingQuestions: nextPending,
    answers: nextAnswers,
    autoFillApplied: canSkipToDraft && pendingQuestions.length > 0,
    completedAt: null,
    awaitingFinalConfirmation: false
  });

  if (
    isSurveyComplete({
      answers: nextAnswers,
      pendingQuestions: nextPending,
      earlyExitRequested: canSkipToDraft
    })
  ) {
    const draftResult = await generateAndPresentDraft({
      context,
      surveyState,
      answers: nextAnswers,
      draftVersion: 1
    });

    return {
      ...draftResult,
      statePatch: {
        ...(draftResult.statePatch ?? {}),
        user_message: content,
        campaign_id: null,
        campaign_workflow_item_id: null,
        campaign_draft_version: 1,
        content_id: null,
        content_workflow_item_id: null,
        content_draft: null,
        forbidden_check: null
      }
    };
  }

  const prompt = buildSurveyPrompt({
    pendingQuestions: nextPending,
    autoFillData,
    answeredSoFar: nextAnswers
  });
  const promptMetadata = buildSurveyPromptMetadata({
    pendingQuestions: nextPending,
    autoFillData,
    answeredSoFar: nextAnswers
  });

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content: prompt,
    ...(Object.keys(promptMetadata).length > 0 ? { metadata: promptMetadata } : {})
  });

  return {
    handled: true,
    outcome: "no_transition",
    statePatch: {
      user_message: content,
      campaign_id: null,
      campaign_plan: null,
      campaign_chain_data: null,
      campaign_plan_document: null,
      campaign_workflow_item_id: null,
      content_id: null,
      content_workflow_item_id: null,
      content_draft: null,
      campaign_survey: surveyState,
      campaign_draft_version: 0,
      forbidden_check: null,
      last_error: null
    },
    completion: "none"
  };
};

export const handleSurveyAnswer = async (context: SkillExecutionContext): Promise<SkillResult> => {
  const content = readUserMessageFromEvent(context);
  const survey = context.state.campaign_survey;
  if (!survey || survey.phase !== "survey_active") {
    throw new HttpError(409, "invalid_state", "campaign_survey.phase must be survey_active.");
  }

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    role: "user",
    content
  });

  const ragContext = await buildEnrichedCampaignContext(context.session.org_id, {
    activityFolder: context.state.activity_folder
  });
  const autoFillData = buildSurveyAutoFillData(ragContext);

  const parsedAnswers = await parseSurveyAnswer({
    userMessage: content,
    pendingQuestions: survey.pending_questions,
    autoFillData,
    answeredSoFar: survey.answers,
    classifyDirectInput: async (input) =>
      classifyCampaignSurveyDirectInput({
        questionId: input.questionId,
        userMessage: input.userMessage,
        choices: input.choices,
        suggestedValue: input.suggestedValue,
        answeredSoFar: (input.answeredSoFar ?? []).map((entry) => ({
          question_id: entry.question_id,
          answer: entry.answer
        }))
      })
  });
  const parsedIds = new Set(parsedAnswers.map((answer) => answer.question_id));

  let nextAnswers = mergeAnswers(survey.answers, parsedAnswers);
  let nextPending = survey.pending_questions.filter((questionId) => !parsedIds.has(questionId));
  const earlyExitRequested = isEarlyExitIntent(content);
  let autoFillApplied = false;

  if (
    earlyExitRequested &&
    canEarlyExit({
      answers: nextAnswers,
      pendingQuestions: nextPending
    })
  ) {
    nextAnswers = applyAutoFillToPendingOptional({
      answers: nextAnswers,
      pendingQuestions: nextPending,
      autoFillData
    });
    nextPending = [];
    autoFillApplied = true;
  }

  const nextSurveyState = buildSurveyState({
    previous: survey,
    phase: "survey_active",
    pendingQuestions: nextPending,
    answers: nextAnswers,
    autoFillApplied,
    completedAt: null,
    awaitingFinalConfirmation: false
  });

  if (
    isSurveyComplete({
      answers: nextAnswers,
      pendingQuestions: nextPending,
      earlyExitRequested
    })
  ) {
    return generateAndPresentDraft({
      context,
      surveyState: nextSurveyState,
      answers: nextAnswers,
      draftVersion: Math.max(1, context.state.campaign_draft_version || 0) || 1
    });
  }

  const prompt = buildSurveyPrompt({
    pendingQuestions: nextPending,
    autoFillData,
    answeredSoFar: nextAnswers
  });
  const promptMetadata = buildSurveyPromptMetadata({
    pendingQuestions: nextPending,
    autoFillData,
    answeredSoFar: nextAnswers
  });
  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content: prompt,
    ...(Object.keys(promptMetadata).length > 0 ? { metadata: promptMetadata } : {})
  });

  return {
    handled: true,
    outcome: "no_transition",
    statePatch: {
      campaign_survey: nextSurveyState,
      last_error: null
    },
    completion: "none"
  };
};

export const handleDraftReviewMessage = async (
  context: SkillExecutionContext,
  intentDeps: DraftReviewIntentDeps
): Promise<SkillResult> => {
  const content = readUserMessageFromEvent(context);
  const survey = context.state.campaign_survey;
  if (!survey || survey.phase !== "draft_review") {
    throw new HttpError(409, "invalid_state", "campaign_survey.phase must be draft_review.");
  }

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    role: "user",
    content
  });

  const normalizedMessage = intentDeps.normalizeMessage(content);
  let llmIntent: "revision" | "satisfaction" | "confirm" | "discussion" | null = null;
  if (intentDeps.classifyIntent) {
    try {
      const llmResult = await intentDeps.classifyIntent({
        userMessage: content,
        awaitingFinalConfirmation: survey.awaiting_final_confirmation
      });
      llmIntent = llmResult?.intent ?? null;
    } catch (error) {
      console.warn("[CAMPAIGN_SURVEY] draft-review intent classification failed:", error);
    }
  }

  const isRevision = intentDeps.isRevisionIntent(normalizedMessage) || llmIntent === "revision";
  const isSatisfaction = intentDeps.isSatisfactionSignal(normalizedMessage) || llmIntent === "satisfaction";
  const isExplicitConfirm = intentDeps.isExplicitConfirmIntent(normalizedMessage) || llmIntent === "confirm";

  if (isRevision) {
    if (!context.state.campaign_plan) {
      throw new HttpError(409, "invalid_state", "campaign_plan is missing for revision.");
    }
    const rerunFromStep = intentDeps.inferCampaignRerunStep(normalizedMessage);
    const nextDraftVersion = Math.max(1, context.state.campaign_draft_version || 1) + 1;

    return generateAndPresentDraft({
      context,
      surveyState: {
        ...survey,
        awaiting_final_confirmation: false
      },
      answers: survey.answers,
      draftVersion: nextDraftVersion,
      revisionReason: content,
      rerunFromStep
    });
  }

  if (isExplicitConfirm || (survey.awaiting_final_confirmation && isSatisfaction)) {
    if (survey.awaiting_final_confirmation) {
      return finalizeCampaignPlan({
        context,
        surveyState: survey
      });
    }

    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: buildConfirmationPrompt()
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        campaign_survey: {
          ...survey,
          awaiting_final_confirmation: true
        },
        last_error: null
      },
      completion: "none"
    };
  }

  if (isSatisfaction) {
    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: buildConfirmationPrompt()
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        campaign_survey: {
          ...survey,
          awaiting_final_confirmation: true
        },
        last_error: null
      },
      completion: "none"
    };
  }

  const assistantReply = await context.deps.generateGeneralAssistantReply({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    activityFolder: context.state.activity_folder,
    currentStep: survey.phase,
    userMessage: content,
    campaignId: context.state.campaign_id,
    contentId: context.state.content_id
  });

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content: assistantReply
  });

  return {
    handled: true,
    outcome: "no_transition",
    statePatch: {
      campaign_survey: {
        ...survey,
        awaiting_final_confirmation: false
      },
      last_error: null
    },
    completion: "none"
  };
};
