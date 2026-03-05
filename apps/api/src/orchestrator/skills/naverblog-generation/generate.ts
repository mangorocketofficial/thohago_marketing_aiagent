import { HttpError } from "../../../lib/errors";
import { callWithFallback } from "../../llm-client";
import { buildBlogGenerationContext } from "./context";
import {
  loadCampaignTitle,
  loadExistingGeneratedResult,
  persistGeneratedContent
} from "./persistence";
import { buildNaverBlogPrompt } from "./prompt";
import { resolveGenerationSlot } from "./slot";
import type { BlogGenerationResult } from "./types";

/**
 * Generate naver blog content and persist both content row and schedule-slot linkage.
 */
export const generateAndPersistNaverBlog = async (params: {
  orgId: string;
  sessionId: string;
  activityFolder: string;
  campaignId: string | null;
  topic: string;
  idempotencyKey: string | null;
}): Promise<BlogGenerationResult> => {
  const target = await resolveGenerationSlot({
    orgId: params.orgId,
    sessionId: params.sessionId,
    campaignId: params.campaignId,
    topic: params.topic,
    idempotencyKey: params.idempotencyKey
  });

  const effectiveTopic = target.slot.title?.trim() || params.topic;
  const existing = await loadExistingGeneratedResult({
    orgId: params.orgId,
    slot: target.slot,
    source: target.source,
    topic: effectiveTopic
  });
  if (existing) {
    return existing;
  }

  const campaignTitle = await loadCampaignTitle({
    orgId: params.orgId,
    campaignId: target.slot.campaign_id
  });

  const context = await buildBlogGenerationContext({
    orgId: params.orgId,
    sessionId: params.sessionId,
    activityFolder: params.activityFolder,
    campaignId: target.slot.campaign_id,
    topic: effectiveTopic
  });

  const result = await callWithFallback({
    prompt: buildNaverBlogPrompt(context),
    maxTokens: 4096,
    orgId: params.orgId
  });

  if (!result.text) {
    throw new HttpError(502, "generation_failed", result.errorMessage ?? "Failed to generate Naver blog content.");
  }

  return persistGeneratedContent({
    orgId: params.orgId,
    slot: target.slot,
    source: target.source,
    topic: effectiveTopic,
    body: result.text,
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    idempotencyKey: params.idempotencyKey,
    campaignTitle
  });
};
