import type { OrchestratorSessionRow, ResumeEventRequest, SessionState } from "../types";
import { SkillRegistry } from "./registry";
import { createCampaignPlanSkill } from "./campaign-plan/index";
import { createInstagramGenerationSkill } from "./instagram-generation/index";
import { createNaverBlogGenerationSkill } from "./naverblog-generation/index";
import type { SkillRouteDecision } from "./types";

const INTENT_CONFIDENCE_THRESHOLD = 0.8;

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizeMessage = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

let singletonRegistry: SkillRegistry | null = null;

export const getSkillRegistry = (): SkillRegistry => {
  if (singletonRegistry) {
    return singletonRegistry;
  }

  const registry = new SkillRegistry();
  registry.register(createCampaignPlanSkill());
  registry.register(createNaverBlogGenerationSkill());
  registry.register(createInstagramGenerationSkill());
  singletonRegistry = registry;
  return registry;
};

export const routeSkill = (params: {
  event: ResumeEventRequest;
  session: OrchestratorSessionRow;
  state: SessionState;
}): SkillRouteDecision | null => {
  const registry = getSkillRegistry();
  const activeSkill = registry.findById(params.state.active_skill);

  if (params.event.event_type !== "user_message") {
    if (activeSkill && activeSkill.handlesEvents.includes(params.event.event_type)) {
      return {
        skill: activeSkill,
        reason: "active_skill",
        confidence: 1,
        note: "active_skill_event_routing"
      };
    }

    const eventSkill = registry.findByEvent(params.event.event_type);
    if (!eventSkill) {
      return null;
    }

    return {
      skill: eventSkill,
      reason: "event_type",
      confidence: 1,
      note: "event_type_routing"
    };
  }

  const content = asString(params.event.payload?.content, "").trim();
  const normalized = normalizeMessage(content);

  const lockedSkill = registry.findById(params.state.skill_lock_id);
  if (lockedSkill && lockedSkill.handlesEvents.includes("user_message")) {
    return {
      skill: lockedSkill,
      reason: "skill_lock",
      confidence: 1,
      note: "skill_lock_continuation"
    };
  }

  const payload = asRecord(params.event.payload);
  const explicitTrigger = asString(payload.skill_trigger, "").trim().toLowerCase();
  if (explicitTrigger) {
    const explicitSkill = registry.findById(explicitTrigger);
    if (
      explicitSkill &&
      explicitSkill.handlesEvents.includes("user_message") &&
      !params.state.active_skill &&
      !params.state.skill_lock_id
    ) {
      return null;
    }
  }

  if (activeSkill && activeSkill.handlesEvents.includes("user_message")) {
    return {
      skill: activeSkill,
      reason: "active_skill",
      confidence: params.state.active_skill ? 1 : null,
      note: "active_skill_continuation"
    };
  }

  const intentMatch = registry.matchIntent(
    {
      session: params.session,
      state: params.state,
      normalizedMessage: normalized,
      tokens: tokenize(normalized)
    },
    {
      threshold: INTENT_CONFIDENCE_THRESHOLD
    }
  );
  if (!intentMatch) {
    return null;
  }

  return intentMatch;
};
