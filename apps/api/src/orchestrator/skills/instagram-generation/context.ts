import { truncateToTokenBudget } from "@repo/rag";
import { getTemplate } from "@repo/media-engine";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { getSessionRollingSummaryText } from "../../conversation-memory";
import { buildEnrichedCampaignContext } from "../../rag-context";
import type { InstagramCaptionContext } from "./prompt";

const BRAND_PROFILE_BUDGET = 1200;
const CONVERSATION_MEMORY_BUDGET = 450;
const ACTIVITY_FILES_BUDGET = 1400;
const CAMPAIGN_CONTEXT_BUDGET = 900;

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const asRecord = (value: unknown): Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const formatInterviewAnswers = (value: unknown): string => {
  const row = asRecord(value);
  const q1 = asString(row.q1).trim();
  const q2 = asString(row.q2).trim();
  const q3 = asString(row.q3).trim();
  const q4 = asString(row.q4).trim();

  const lines = [
    q1 ? `- Tone and manner: ${q1}` : "",
    q2 ? `- Target audience: ${q2}` : "",
    q3 ? `- Forbidden words/topics: ${q3}` : "",
    q4 ? `- Campaign seasons: ${q4}` : ""
  ].filter(Boolean);
  return lines.join("\n");
};

const loadCampaignContext = async (params: { orgId: string; campaignId: string | null }): Promise<string | null> => {
  if (!params.campaignId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("title,plan,plan_document")
    .eq("org_id", params.orgId)
    .eq("id", params.campaignId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn(`[INSTAGRAM_SKILL] Failed to load campaign context: ${error.message}`);
    }
    return null;
  }

  const row = asRecord(data);
  const title = asString(row.title).trim();
  const planDocument = asString(row.plan_document).trim();
  const planRaw = row.plan;
  const planJson = planRaw && typeof planRaw === "object" && !Array.isArray(planRaw) ? JSON.stringify(planRaw, null, 2) : "";

  const merged = [
    title ? `[Campaign Title]\n${title}` : "",
    planDocument ? `[Campaign Plan Document]\n${planDocument}` : "",
    planJson ? `[Campaign Plan JSON]\n${planJson}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return merged ? truncateToTokenBudget(merged, CAMPAIGN_CONTEXT_BUDGET) : null;
};

/**
 * Build context used in instagram caption generation prompt.
 */
export const buildInstagramGenerationContext = async (params: {
  orgId: string;
  sessionId: string;
  activityFolder: string;
  campaignId: string | null;
  topic: string;
  templateId: string;
}): Promise<InstagramCaptionContext> => {
  const [enriched, rollingSummary, campaignContext] = await Promise.all([
    buildEnrichedCampaignContext(params.orgId, {
      activityFolder: params.activityFolder
    }),
    getSessionRollingSummaryText({
      orgId: params.orgId,
      sessionId: params.sessionId
    }),
    loadCampaignContext({
      orgId: params.orgId,
      campaignId: params.campaignId
    })
  ]);

  const interviewAnswers = formatInterviewAnswers(enriched.interviewAnswers);
  const brandProfile = truncateToTokenBudget(
    [
      enriched.brandReviewMd ? `[Brand Review]\n${enriched.brandReviewMd}` : "",
      interviewAnswers ? `[Interview Answers]\n${interviewAnswers}` : ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    BRAND_PROFILE_BUDGET
  );

  const activityFiles = truncateToTokenBudget(enriched.documentExtracts ?? "", ACTIVITY_FILES_BUDGET);
  const conversationMemory = truncateToTokenBudget(rollingSummary || enriched.memoryMd || "", CONVERSATION_MEMORY_BUDGET);
  const template = getTemplate(params.templateId);
  const textSlotIds = template?.texts.map((slot) => slot.id).filter((slotId) => !!slotId) ?? [];

  return {
    brandProfile: brandProfile || "(No brand profile context available)",
    activityFiles: activityFiles || "(No related activity files retrieved)",
    conversationMemory: conversationMemory || "(No conversation memory available)",
    campaignContext,
    topic: params.topic,
    channel: "instagram",
    templateId: params.templateId,
    textSlotIds
  };
};
