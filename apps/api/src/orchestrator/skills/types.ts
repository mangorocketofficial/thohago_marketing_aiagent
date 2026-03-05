import type { CampaignStepDeps } from "../steps/campaign";
import type { ContentStepDeps } from "../steps/content";
import type {
  OrchestratorSessionRow,
  OrchestratorStep,
  ResumeEventRequest,
  ResumeEventType,
  SessionState
} from "../types";

export type SkillOutcome =
  | "no_transition"
  | "await_campaign_approval"
  | "await_content_approval"
  | "session_done"
  | "session_failed";

export type SkillRouteReason = "active_skill" | "event_type" | "intent" | "explicit_trigger" | "skill_lock" | "llm_intent";

export type SkillResult = {
  handled: boolean;
  outcome: SkillOutcome;
  statePatch?: Partial<SessionState>;
  completion?: "none" | "kickoff_next";
  telemetry?: {
    skillId: string;
    routeReason: SkillRouteReason;
    confidence?: number | null;
    note?: string;
  };
};

export type SkillIntentInput = {
  session: OrchestratorSessionRow;
  state: SessionState;
  normalizedMessage: string;
  tokens: string[];
};

export type SkillIntentMatch = {
  confidence: number;
  reason: string;
};

export type SkillDeps = {
  campaign: CampaignStepDeps;
  content: ContentStepDeps;
  asString: (value: unknown, fallback?: string) => string;
  normalizeStep: (value: unknown) => OrchestratorStep;
  generateGeneralAssistantReply: (params: {
    orgId: string;
    sessionId: string;
    userId?: string | null;
    activityFolder: string;
    currentStep: string;
    userMessage: string;
    campaignId?: string | null;
    contentId?: string | null;
  }) => Promise<string>;
};

export type SkillExecutionContext = {
  session: OrchestratorSessionRow;
  state: SessionState;
  event: ResumeEventRequest;
  idempotencyKey: string | null;
  routeReason: SkillRouteReason;
  routeConfidence: number | null;
  deps: SkillDeps;
};

export type Skill = {
  id: string;
  displayName: string;
  version: string;
  priority: number;
  handlesEvents: ResumeEventType[];
  matchIntent?: (input: SkillIntentInput) => SkillIntentMatch | null;
  execute: (context: SkillExecutionContext) => Promise<SkillResult>;
};

export type SkillRouteDecision = {
  skill: Skill;
  reason: SkillRouteReason;
  confidence: number | null;
  note?: string;
};
