import { HttpError } from "../../../lib/errors";
import { classifyCampaignDraftReviewIntent } from "../../ai";
import {
  handleDraftReviewMessage,
  handleSurveyAnswer,
  handleSurveyStart
} from "../../steps/campaign-survey";
import type { ChainStepName } from "./chain-types";
import type { Skill, SkillExecutionContext, SkillIntentInput, SkillResult } from "../types";

const SKILL_ID = "campaign_plan";
const SKILL_VERSION = "5.5.0";

const CAMPAIGN_NOUNS = ["캠페인", "campaign", "프로모션", "promotion"];
const STRONG_PLAN_PHRASES = ["캠페인 기획", "캠페인 계획", "캠페인 전략", "campaign plan", "plan campaign"];
const ACTION_TERMS = ["기획", "계획", "전략", "플랜", "만들", "작성", "생성", "설계", "시작", "launch", "start"];
const QUERY_TERMS = ["결과", "상태", "진행", "조회", "확인", "성과", "리포트", "report", "status", "update"];
const APPROVAL_TERMS = ["승인", "approve", "확정"];
const REJECT_TERMS = ["거절", "reject", "취소", "cancel"];
const REVISION_TERMS = [
  "수정",
  "변경",
  "바꿔",
  "바꾸",
  "조정",
  "보완",
  "재작성",
  "다시",
  "revise",
  "revision",
  "change",
  "update",
  "modify",
  "rewrite",
  "adjust"
];
const STRONG_REVISION_TERMS = ["수정", "변경", "바꿔", "바꾸", "조정", "revise", "modify", "rewrite", "adjust"];
const SATISFACTION_TERMS = [
  "좋아",
  "좋다",
  "좋아요",
  "좋습니다",
  "좋네요",
  "괜찮아",
  "괜찮네요",
  "마음에 들어",
  "마음에 든다",
  "오케이",
  "ok",
  "ㅇㅋ",
  "looks good",
  "sounds good",
  "good to me"
];
const EXPLICIT_CONFIRM_TERMS = [
  "네",
  "예",
  "승인",
  "승인해",
  "승인할게",
  "최종승인",
  "최종 확정",
  "최종승인할게",
  "확정해",
  "확정",
  "확정할게",
  "확정하자",
  "확인할게",
  "확인합니다",
  "진행해",
  "진행해주세요",
  "go ahead",
  "proceed",
  "confirm",
  "approved",
  "yes",
  "yes proceed"
];

const STEP_A_TERMS = ["타깃", "타겟", "대상", "audience", "persona", "메시지", "message", "pain point", "problem"];
const STEP_B_TERMS = ["채널", "전략", "platform", "인스타", "instagram", "threads", "tone", "format", "포맷"];
const STEP_C_TERMS = ["캘린더", "일정", "스케줄", "calendar", "schedule", "주차", "week", "day", "post"];
const STEP_D_TERMS = ["실행", "예산", "kpi", "리스크", "risk", "asset", "자산", "보고", "측정", "execution"];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, patterns: string[]): boolean => patterns.some((pattern) => text.includes(pattern));

const scoreStep = (text: string, patterns: string[]): number =>
  patterns.reduce((score, pattern) => score + (text.includes(pattern) ? 1 : 0), 0);

const inferCampaignRerunStep = (normalizedMessage: string): ChainStepName => {
  const scores: Record<ChainStepName, number> = {
    step_a: scoreStep(normalizedMessage, STEP_A_TERMS),
    step_b: scoreStep(normalizedMessage, STEP_B_TERMS),
    step_c: scoreStep(normalizedMessage, STEP_C_TERMS),
    step_d: scoreStep(normalizedMessage, STEP_D_TERMS)
  };

  let bestStep: ChainStepName = "step_b";
  let bestScore = scores.step_b;
  const ordered: ChainStepName[] = ["step_a", "step_b", "step_c", "step_d"];

  for (const step of ordered) {
    const score = scores[step];
    if (score > bestScore) {
      bestStep = step;
      bestScore = score;
    }
  }

  return bestStep;
};

const isCampaignRevisionIntent = (normalizedMessage: string): boolean => {
  if (!normalizedMessage) {
    return false;
  }
  if (hasAny(normalizedMessage, APPROVAL_TERMS) || hasAny(normalizedMessage, REJECT_TERMS)) {
    return false;
  }
  if (hasAny(normalizedMessage, QUERY_TERMS) && !hasAny(normalizedMessage, STRONG_REVISION_TERMS)) {
    return false;
  }
  if (hasAny(normalizedMessage, REVISION_TERMS)) {
    return true;
  }

  const hasStepSignal =
    hasAny(normalizedMessage, STEP_A_TERMS) ||
    hasAny(normalizedMessage, STEP_B_TERMS) ||
    hasAny(normalizedMessage, STEP_C_TERMS) ||
    hasAny(normalizedMessage, STEP_D_TERMS);

  return hasStepSignal && normalizedMessage.includes("해줘");
};

const isSatisfactionSignal = (normalizedMessage: string): boolean => {
  if (!normalizedMessage) {
    return false;
  }
  if (isCampaignRevisionIntent(normalizedMessage)) {
    return false;
  }
  if (hasAny(normalizedMessage, EXPLICIT_CONFIRM_TERMS)) {
    return false;
  }
  return hasAny(normalizedMessage, SATISFACTION_TERMS);
};

const isExplicitConfirmIntent = (normalizedMessage: string): boolean => {
  if (!normalizedMessage) {
    return false;
  }
  if (isCampaignRevisionIntent(normalizedMessage)) {
    return false;
  }
  return hasAny(normalizedMessage, EXPLICIT_CONFIRM_TERMS);
};

export const detectCampaignDraftReviewIntent = (userMessage: string): {
  normalizedMessage: string;
  revision: boolean;
  satisfaction: boolean;
  explicitConfirm: boolean;
  rerunFromStep: ChainStepName;
} => {
  const normalizedMessage = normalizeText(userMessage);
  return {
    normalizedMessage,
    revision: isCampaignRevisionIntent(normalizedMessage),
    satisfaction: isSatisfactionSignal(normalizedMessage),
    explicitConfirm: isExplicitConfirmIntent(normalizedMessage),
    rerunFromStep: inferCampaignRerunStep(normalizedMessage)
  };
};

const withTelemetry = (context: SkillExecutionContext, result: SkillResult, note: string): SkillResult => ({
  ...result,
  telemetry: {
    skillId: SKILL_ID,
    routeReason: context.routeReason,
    confidence: context.routeConfidence,
    note
  }
});

const handleGeneralMessage = async (context: SkillExecutionContext): Promise<SkillResult> => {
  const content = context.deps.asString(context.event.payload?.content, "").trim();
  if (!content) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "user",
    content
  });

  const assistantReply = await context.deps.generateGeneralAssistantReply({
    activityFolder: context.state.activity_folder,
    currentStep: context.state.campaign_survey?.phase ?? context.session.current_step,
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
      last_error: null
    },
    completion: "none"
  };
};

const matchCampaignPlanIntent = (input: SkillIntentInput) => {
  if (input.session.current_step !== "await_user_input") {
    return null;
  }

  const normalizedMessage = normalizeText(input.normalizedMessage);
  if (!normalizedMessage) {
    return null;
  }

  const hasCampaignNoun = hasAny(normalizedMessage, CAMPAIGN_NOUNS);
  if (!hasCampaignNoun) {
    return null;
  }

  const hasStrongPhrase = hasAny(normalizedMessage, STRONG_PLAN_PHRASES);
  const hasAction = hasAny(normalizedMessage, ACTION_TERMS);
  const hasQuery = hasAny(normalizedMessage, QUERY_TERMS);

  if (hasStrongPhrase && !hasQuery) {
    return {
      confidence: 0.96,
      reason: "strong_campaign_plan_phrase"
    };
  }

  if (hasAction && !hasQuery) {
    return {
      confidence: 0.86,
      reason: "campaign_action_term"
    };
  }

  if (hasQuery && !hasAction) {
    return null;
  }

  return null;
};

export const createCampaignPlanSkill = (): Skill => ({
  id: SKILL_ID,
  displayName: "Campaign Plan",
  version: SKILL_VERSION,
  priority: 100,
  handlesEvents: ["user_message"],
  matchIntent: matchCampaignPlanIntent,
  execute: async (context: SkillExecutionContext): Promise<SkillResult> => {
    if (context.event.event_type !== "user_message") {
      return {
        handled: false,
        outcome: "no_transition",
        completion: "none",
        telemetry: {
          skillId: SKILL_ID,
          routeReason: context.routeReason,
          confidence: context.routeConfidence,
          note: `unsupported_event:${context.event.event_type}`
        }
      };
    }

    const surveyPhase = context.state.campaign_survey?.phase ?? null;

    if (surveyPhase === "survey_active") {
      const result = await handleSurveyAnswer(context);
      return withTelemetry(context, result, "survey_answer");
    }

    if (surveyPhase === "draft_review") {
      const result = await handleDraftReviewMessage(context, {
        normalizeMessage: normalizeText,
        isRevisionIntent: isCampaignRevisionIntent,
        inferCampaignRerunStep,
        isSatisfactionSignal,
        isExplicitConfirmIntent,
        classifyIntent: ({ userMessage, awaitingFinalConfirmation }) =>
          classifyCampaignDraftReviewIntent({
            userMessage,
            awaitingFinalConfirmation
          })
      });
      return withTelemetry(context, result, "draft_review");
    }

    if (context.session.current_step === "await_user_input") {
      const result = await handleSurveyStart(context);
      return withTelemetry(context, result, "survey_start");
    }

    if (context.session.current_step === "await_content_approval") {
      const result = await handleGeneralMessage(context);
      return withTelemetry(context, result, "legacy_content_approval_message");
    }

    const result = await handleGeneralMessage(context);
    return withTelemetry(context, result, "fallback_general_message");
  }
});
