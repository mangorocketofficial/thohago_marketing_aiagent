import { HttpError } from "../../../lib/errors";
import {
  applyCampaignApprovedStep,
  applyCampaignRejectStep,
  applyUserMessageStep
} from "../../steps/campaign";
import type { OrchestratorStep, SessionStatus } from "../../types";
import type { Skill, SkillExecutionContext, SkillIntentInput, SkillOutcome, SkillResult } from "../types";

const SKILL_ID = "campaign_plan";
const SKILL_VERSION = "5.2.0";

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

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasAny = (text: string, patterns: string[]): boolean => patterns.some((pattern) => text.includes(pattern));

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
        if (
          context.session.current_step === "await_campaign_approval" ||
          context.session.current_step === "await_content_approval"
        ) {
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
