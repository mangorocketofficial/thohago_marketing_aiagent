import { HttpError } from "../../../lib/errors";
import { getTemplate, type TemplateId } from "@repo/media-engine";
import { callWithFallback } from "../../llm-client";
import { buildInstagramGenerationContext } from "./context";
import { selectImagesForInstagram } from "./image-selector";
import {
  deleteContentDraft,
  insertDraftInstagramContent,
  linkContentToSlot,
  loadCampaignTitle,
  loadExistingGeneratedResult,
  markSlotGenerationFailed
} from "./persistence";
import { buildInstagramPrompt, parseInstagramDraft } from "./prompt";
import { resolveInstagramGenerationSlot } from "./slot";
import type { InstagramGenerationResult, InstagramImageMode } from "./types";

const DEFAULT_TEMPLATE_ID: TemplateId = "koica_cover_01";

/**
 * Generate instagram caption/template seed and persist metadata for local composition.
 */
export const generateAndPersistInstagram = async (params: {
  orgId: string;
  sessionId: string;
  activityFolder: string;
  campaignId: string | null;
  topic: string;
  imageMode: InstagramImageMode;
  templateId: string | null;
  manualImageSelections?: string[];
  idempotencyKey: string | null;
}): Promise<InstagramGenerationResult> => {
  const target = await resolveInstagramGenerationSlot({
    orgId: params.orgId,
    sessionId: params.sessionId,
    campaignId: params.campaignId,
    topic: params.topic,
    idempotencyKey: params.idempotencyKey
  });

  try {
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

    const templateId = normalizeTemplateId(params.templateId);
    const context = await buildInstagramGenerationContext({
      orgId: params.orgId,
      sessionId: params.sessionId,
      activityFolder: params.activityFolder,
      campaignId: target.slot.campaign_id,
      topic: effectiveTopic,
      templateId
    });

    const llm = await callWithFallback({
      orgId: params.orgId,
      prompt: buildInstagramPrompt(context),
      maxTokens: 2048
    });

    if (!llm.text) {
      throw new HttpError(502, "generation_failed", llm.errorMessage ?? "Failed to generate instagram caption.");
    }

    const parsedDraft = parseInstagramDraft(llm.text);
    const template = getTemplate(templateId);
    const requiredCount = template ? Math.max(0, template.photos.filter((slot) => !slot.optional).length) : 1;
    const overlayTexts = buildOverlayTextMap(templateId, parsedDraft.overlayTexts);

    const selected = await selectImagesForInstagram({
      orgId: params.orgId,
      activityFolder: params.activityFolder,
      topic: effectiveTopic,
      mode: params.imageMode,
      requiredCount,
      manualSelections: params.manualImageSelections
    });

    const outputFormat: "png" | "jpg" = "png";
    const campaignTitle = await loadCampaignTitle({
      orgId: params.orgId,
      campaignId: target.slot.campaign_id
    });

    const caption = composeCaption(parsedDraft.caption, parsedDraft.hashtags);
    const inserted = await insertDraftInstagramContent({
      orgId: params.orgId,
      slot: target.slot,
      source: target.source,
      activityFolder: params.activityFolder,
      topic: effectiveTopic,
      caption,
      hashtags: parsedDraft.hashtags,
      overlayTexts,
      templateId,
      selectedImageFileIds: selected.selectedImages.map((entry) => entry.fileId),
      selectedImagePaths: selected.selectedImages.map((entry) => entry.relativePath),
      imageSelectionSource: selected.selectionSource,
      imageSelectionReason: selected.telemetryReason,
      model: llm.model,
      promptTokens: llm.promptTokens,
      completionTokens: llm.completionTokens,
      idempotencyKey: params.idempotencyKey,
      outputFormat,
      campaignTitle
    });

    try {
      await linkContentToSlot({
        orgId: params.orgId,
        slot: target.slot,
        contentId: inserted.contentId,
        source: target.source,
        idempotencyKey: params.idempotencyKey
      });
    } catch (error) {
      await deleteContentDraft({ orgId: params.orgId, contentId: inserted.contentId });
      throw error;
    }

    return {
      contentId: inserted.contentId,
      slotId: target.slot.id,
      source: target.source,
      topic: effectiveTopic,
      caption,
      model: llm.model,
      templateId,
      overlayTexts,
      imageFileIds: selected.selectedImages.map((entry) => entry.fileId),
      selectedImagePaths: selected.selectedImages.map((entry) => entry.relativePath),
      imageSelectionSource: selected.selectionSource,
      imageSelectionReason: selected.telemetryReason,
      requiresLocalCompose: true,
      localSaveSuggestion: inserted.localSaveSuggestion,
      reused: false
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown instagram generation error";
    await markSlotGenerationFailed({
      orgId: params.orgId,
      slot: target.slot,
      reason
    });
    throw error;
  }
};

const normalizeTemplateId = (templateId: string | null): TemplateId =>
  templateId && getTemplate(templateId) ? templateId : DEFAULT_TEMPLATE_ID;

const buildOverlayTextMap = (templateId: TemplateId, overlayTexts: Record<string, string>): Record<string, string> => {
  const template = getTemplate(templateId);
  const textSlots = template?.texts ?? [];
  const map: Record<string, string> = {};
  if (textSlots.length === 0) {
    return map;
  }

  const normalizedInput = normalizeOverlayTextMap(overlayTexts);
  const titleFallback = pickFirstText(normalizedInput, ["title", "main", "headline"]);
  const subFallback = pickFirstText(normalizedInput, ["author", "sub", "subtitle", "description"]);
  for (const slot of textSlots) {
    const exact = normalizedInput[slot.id] ?? "";
    if (exact) {
      map[slot.id] = exact;
      continue;
    }
    if (/title|headline|subject/i.test(slot.id) && titleFallback) {
      map[slot.id] = titleFallback;
      continue;
    }
    if (/author|sub|subtitle|desc/i.test(slot.id) && subFallback) {
      map[slot.id] = subFallback;
      continue;
    }
    map[slot.id] = "";
  }

  return map;
};

const normalizeOverlayTextMap = (value: Record<string, string>): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const slotId = key.trim();
    if (!slotId) {
      continue;
    }
    next[slotId] = `${entry ?? ""}`.trim().slice(0, 120);
  }
  return next;
};

const pickFirstText = (overlayTexts: Record<string, string>, aliases: string[]): string => {
  for (const alias of aliases) {
    const value = overlayTexts[alias];
    if (value) {
      return value;
    }
  }
  return "";
};

const composeCaption = (caption: string, hashtags: string[]): string => {
  const trimmed = caption.trim();
  const hashLine = hashtags.map((entry) => (entry.startsWith("#") ? entry : `#${entry}`)).join(" ");
  if (!hashLine) {
    return trimmed;
  }
  if (trimmed.includes("#")) {
    return trimmed;
  }
  return `${trimmed}\n\n${hashLine}`.trim();
};
