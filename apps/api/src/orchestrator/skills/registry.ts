import type { ResumeEventType } from "../types";
import type { Skill, SkillIntentInput, SkillRouteDecision } from "./types";

type RegistrySkillMatch = {
  skill: Skill;
  confidence: number;
  reason: string;
};

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    this.skills.set(skill.id, skill);
  }

  getAll(): Skill[] {
    return [...this.skills.values()].sort((left, right) => right.priority - left.priority);
  }

  findById(id: string | null | undefined): Skill | null {
    if (!id) {
      return null;
    }
    return this.skills.get(id) ?? null;
  }

  findByEvent(eventType: ResumeEventType): Skill | null {
    for (const skill of this.getAll()) {
      if (skill.handlesEvents.includes(eventType)) {
        return skill;
      }
    }
    return null;
  }

  matchIntent(input: SkillIntentInput, options?: { threshold?: number }): SkillRouteDecision | null {
    const threshold = options?.threshold ?? 0.75;
    let best: RegistrySkillMatch | null = null;

    for (const skill of this.getAll()) {
      if (!skill.matchIntent) {
        continue;
      }
      const match = skill.matchIntent(input);
      if (!match) {
        continue;
      }

      if (!best) {
        best = {
          skill,
          confidence: match.confidence,
          reason: match.reason
        };
        continue;
      }

      if (match.confidence > best.confidence) {
        best = {
          skill,
          confidence: match.confidence,
          reason: match.reason
        };
      }
    }

    if (!best || best.confidence < threshold) {
      return null;
    }

    return {
      skill: best.skill,
      reason: "intent",
      confidence: best.confidence,
      note: best.reason
    };
  }
}
