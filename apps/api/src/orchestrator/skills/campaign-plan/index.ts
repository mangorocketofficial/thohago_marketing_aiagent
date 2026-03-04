import { HttpError } from "../../../lib/errors";
import {
  applyCampaignApprovedStep,
  applyCampaignRejectStep,
  applyUserMessageStep
} from "../../steps/campaign";
import type { OrchestratorStep, SessionStatus } from "../../types";
import type { Skill, SkillExecutionContext, SkillIntentInput, SkillOutcome, SkillResult } from "../types";

const SKILL_ID = "campaign_plan";
const SKILL_VERSION = "5.4.0";

const CAMPAIGN_NOUNS = ["\uCEA0\uD398\uC778", "campaign", "\uD504\uB85C\uBAA8\uC158", "promotion"];
const STRONG_PLAN_PHRASES = [
  "\uCEA0\uD398\uC778 \uAE30\uD68D",
  "\uCEA0\uD398\uC778 \uACC4\uD68D",
  "\uCEA0\uD398\uC778 \uC804\uB7B5",
  "campaign plan",
  "plan campaign"
];
const ACTION_TERMS = [
  "\uAE30\uD68D",
  "\uACC4\uD68D",
  "\uC804\uB7B5",
  "\uD50C\uB79C",
  "\uB9CC\uB4E4",
  "\uC791\uC131",
  "\uC0DD\uC131",
  "\uC124\uACC4",
  "\uC2DC\uC791",
  "launch",
  "start"
];
const QUERY_TERMS = [
  "\uACB0\uACFC",
  "\uC0C1\uD0DC",
  "\uC9C4\uD589",
  "\uC870\uD68C",
  "\uD655\uC778",
  "\uC131\uACFC",
  "\uB9AC\uD3EC\uD2B8",
  "report",
  "status",
  "update"
];
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
  "수정해",
  "수정해줘",
  "revise",
  "revision",
  "change",
  "update",
  "modify",
  "rewrite",
  "adjust"
];
const STRONG_REVISION_TERMS = ["수정", "변경", "바꿔", "바꾸", "조정", "revise", "modify", "rewrite", "adjust"];

type CampaignRerunStep = "step_a" | "step_b" | "step_c" | "step_d";

const STEP_A_TERMS = [
  "타깃",
  "타겟",
  "대상",
  "audience",
  "persona",
  "메시지",
  "message",
  "pain point",
  "problem"
];
const STEP_B_TERMS = [
  "채널",
  "전략",
  "platform",
  "인스타",
  "instagram",
  "threads",
  "tone",
  "format",
  "포맷"
];
const STEP_C_TERMS = [
  "캘린더",
  "일정",
  "스케줄",
  "calendar",
  "schedule",
  "주차",
  "week",
  "day",
  "post"
];
const STEP_D_TERMS = [
  "실행",
  "예산",
  "kpi",
  "리스크",
  "risk",
  "asset",
  "자산",
  "보고",
  "측정",
  "execution"
];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, patterns: string[]): boolean => patterns.some((pattern) => text.includes(pattern));

const scoreStep = (text: string, patterns: string[]): number =>
  patterns.reduce((score, pattern) => score + (text.includes(pattern) ? 1 : 0), 0);

const inferCampaignRerunStep = (normalizedMessage: string): CampaignRerunStep => {
  const scores: Record<CampaignRerunStep, number> = {
    step_a: scoreStep(normalizedMessage, STEP_A_TERMS),
    step_b: scoreStep(normalizedMessage, STEP_B_TERMS),
    step_c: scoreStep(normalizedMessage, STEP_C_TERMS),
    step_d: scoreStep(normalizedMessage, STEP_D_TERMS)
  };

  let bestStep: CampaignRerunStep = "step_b";
  let bestScore = scores.step_b;

  const orderedSteps: CampaignRerunStep[] = ["step_a", "step_b", "step_c", "step_d"];
  for (const step of orderedSteps) {
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

const mapTransitionToOutcome = (step: OrchestratorStep, status: SessionStatus): SkillOutcome => {
  if (status === "failed") {
    return "session_failed";
  }
  if (status === "done" || step === "done") {
    return "session_done";
  }
  if (step === "await_campaign_approval") {
    return "await_campaign_approval";
  }
  if (step === "await_content_approval") {
    return "await_content_approval";
  }
  return "no_transition";
};

const handleGeneralMessageDuringApproval = async (context: SkillExecutionContext): Promise<SkillResult> => {
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
    currentStep: context.session.current_step,
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

const handleChatDrivenCampaignRevision = async (context: SkillExecutionContext): Promise<SkillResult> => {
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

  const normalizedMessage = normalizeText(content);
  const rerunFromStep = inferCampaignRerunStep(normalizedMessage);
  const next = await applyCampaignRejectStep(
    context.session,
    context.state,
    {
      campaign_id: context.state.campaign_id,
      mode: "revision",
      reason: content,
      rerun_from_step: rerunFromStep
    },
    context.idempotencyKey,
    context.deps.campaign
  );

  return {
    handled: true,
    outcome: mapTransitionToOutcome(next.step, next.status),
    statePatch: next.state,
    completion: "none",
    telemetry: {
      skillId: SKILL_ID,
      routeReason: context.routeReason,
      confidence: context.routeConfidence,
      note: `campaign_chat_revision:${rerunFromStep}`
    }
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
  handlesEvents: ["user_message", "campaign_approved", "campaign_rejected"],
  matchIntent: matchCampaignPlanIntent,
  execute: async (context: SkillExecutionContext): Promise<SkillResult> => {
    switch (context.event.event_type) {
      case "user_message": {
        if (context.session.current_step === "await_campaign_approval") {
          const content = context.deps.asString(context.event.payload?.content, "").trim();
          const normalizedMessage = normalizeText(content);
          if (isCampaignRevisionIntent(normalizedMessage)) {
            return handleChatDrivenCampaignRevision(context);
          }
          return handleGeneralMessageDuringApproval(context);
        }

        if (context.session.current_step === "await_content_approval") {
          return handleGeneralMessageDuringApproval(context);
        }

        const next = await applyUserMessageStep(
          context.session,
          context.state,
          context.event.payload,
          context.idempotencyKey,
          context.deps.campaign
        );

        return {
          handled: true,
          outcome: mapTransitionToOutcome(next.step, next.status),
          statePatch: next.state,
          completion: "none",
          telemetry: {
            skillId: SKILL_ID,
            routeReason: context.routeReason,
            confidence: context.routeConfidence,
            note: "campaign_user_message"
          }
        };
      }
      case "campaign_approved": {
        const next = await applyCampaignApprovedStep(
          context.session,
          context.state,
          context.event.payload,
          context.idempotencyKey,
          context.deps.campaign
        );

        return {
          handled: true,
          outcome: mapTransitionToOutcome(next.step, next.status),
          statePatch: next.state,
          completion: "none",
          telemetry: {
            skillId: SKILL_ID,
            routeReason: context.routeReason,
            confidence: context.routeConfidence,
            note: "campaign_approved"
          }
        };
      }
      case "campaign_rejected": {
        const next = await applyCampaignRejectStep(
          context.session,
          context.state,
          context.event.payload,
          context.idempotencyKey,
          context.deps.campaign
        );

        return {
          handled: true,
          outcome: mapTransitionToOutcome(next.step, next.status),
          statePatch: next.state,
          completion: next.completed ? "kickoff_next" : "none",
          telemetry: {
            skillId: SKILL_ID,
            routeReason: context.routeReason,
            confidence: context.routeConfidence,
            note: next.completed ? "campaign_rejected_terminal" : "campaign_rejected_revision"
          }
        };
      }
      default:
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
  }
});
