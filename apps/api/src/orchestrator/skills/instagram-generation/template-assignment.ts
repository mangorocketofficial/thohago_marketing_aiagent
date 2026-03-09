import { getAllTemplates, type TemplateId } from "@repo/media-engine";
import type { InstagramSlideDraft, InstagramSlideRole } from "./types";

const KOICA_TEMPLATE_FAMILY = ["koica_cover_01", "koica_story_02", "koica_stats_03", "koica_cta_04"] as const;

const ROLE_TEMPLATE_PREFERENCES: Record<InstagramSlideRole, string[]> = {
  cover: ["koica_cover_01", "koica_story_02"],
  problem: ["koica_stats_03", "koica_story_02"],
  solution: ["koica_story_02", "koica_cover_01"],
  benefit: ["koica_story_02", "koica_cover_01"],
  data: ["koica_stats_03", "koica_story_02"],
  detail: ["koica_story_02", "koica_cover_01"],
  testimonial: ["koica_story_02", "koica_cover_01"],
  cta: ["koica_cta_04", "koica_cover_01"],
  custom: ["koica_cover_01", "koica_story_02"]
};

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const resolveAvailableTemplateIds = (baseTemplateId: string): TemplateId[] => {
  const available = new Set(getAllTemplates().map((template) => template.template_id));
  const prioritized = dedupe([baseTemplateId, ...KOICA_TEMPLATE_FAMILY]).filter((templateId) => available.has(templateId));
  if (prioritized.length > 0) {
    return prioritized as TemplateId[];
  }

  const fallback = [...available];
  return (fallback.length > 0 ? fallback : [baseTemplateId]) as TemplateId[];
};

/**
 * Pick a slide template sequence that keeps the cover on the base template
 * while varying later slides by role when the preset family is available.
 */
export const assignSlideTemplateIds = (params: {
  baseTemplateId: TemplateId;
  slideDrafts: InstagramSlideDraft[];
}): TemplateId[] => {
  if (params.slideDrafts.length === 0) {
    return [];
  }

  const available = resolveAvailableTemplateIds(params.baseTemplateId);
  const availableSet = new Set<string>(available);
  const fallbackRotation = dedupe([...available, params.baseTemplateId]);
  const assigned: TemplateId[] = [];

  for (const [index, slide] of params.slideDrafts.entries()) {
    if (index === 0 && availableSet.has(params.baseTemplateId)) {
      assigned.push(params.baseTemplateId);
      continue;
    }

    const preferred = dedupe([
      ...(ROLE_TEMPLATE_PREFERENCES[slide.role] ?? []),
      ...fallbackRotation,
      params.baseTemplateId
    ]);
    const previousTemplateId = assigned[index - 1] ?? "";
    const nonRepeating = preferred.find((candidate) => availableSet.has(candidate) && candidate !== previousTemplateId);
    if (nonRepeating) {
      assigned.push(nonRepeating as TemplateId);
      continue;
    }

    for (const candidate of preferred) {
      if (availableSet.has(candidate)) {
        assigned.push(candidate as TemplateId);
        break;
      }
    }
  }

  return assigned.length === params.slideDrafts.length ? assigned : params.slideDrafts.map(() => params.baseTemplateId);
};
