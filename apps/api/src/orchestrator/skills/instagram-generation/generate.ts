import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { composeInstagramImage } from "../../../media/image-composer";
import { getTemplate } from "../../../media/templates/registry";
import type { TemplateId } from "../../../media/templates/schema";
import { callWithFallback } from "../../llm-client";
import { buildInstagramGenerationContext } from "./context";
import { selectImagesForInstagram } from "./image-selector";
import {
  deleteContentDraft,
  insertDraftInstagramContent,
  linkContentToSlot,
  loadCampaignTitle,
  loadExistingGeneratedResult,
  updateContentStorageMetadata
} from "./persistence";
import { buildInstagramPrompt, parseInstagramDraft } from "./prompt";
import { resolveInstagramGenerationSlot } from "./slot";
import type { InstagramGenerationResult, InstagramImageMode } from "./types";

const DEFAULT_TEMPLATE_ID: TemplateId = "center-image-bottom-text";
const STORAGE_BUCKET = "content-images-private";

/**
 * Generate instagram content (caption + composed image) and persist with rollback guards.
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
  const requiredCount = template?.layers.userImageAreas?.length ?? 1;

  const selected = await selectImagesForInstagram({
    orgId: params.orgId,
    activityFolder: params.activityFolder,
    topic: effectiveTopic,
    mode: params.imageMode,
    requiredCount,
    manualSelections: params.manualImageSelections
  });

  const outputFormat: "png" | "jpg" = "png";
  const composed = await composeInstagramImage({
    templateId,
    userImages: selected.selectedImages.map((entry) => entry.filePath),
    overlayMainText: parsedDraft.overlayMain,
    overlaySubText: parsedDraft.overlaySub,
    outputFormat
  });

  const campaignTitle = await loadCampaignTitle({
    orgId: params.orgId,
    campaignId: target.slot.campaign_id
  });

  const caption = composeCaption(parsedDraft.caption, parsedDraft.hashtags);
  const inserted = await insertDraftInstagramContent({
    orgId: params.orgId,
    slot: target.slot,
    source: target.source,
    topic: effectiveTopic,
    caption,
    hashtags: parsedDraft.hashtags,
    overlayMain: parsedDraft.overlayMain,
    overlaySub: parsedDraft.overlaySub,
    templateId,
    selectedImagePaths: selected.selectedImages.map((entry) => entry.filePath),
    model: llm.model,
    promptTokens: llm.promptTokens,
    completionTokens: llm.completionTokens,
    idempotencyKey: params.idempotencyKey,
    outputFormat,
    campaignTitle
  });

  const extension = "png";
  const contentType = "image/png";
  const storagePath = `${params.orgId}/${inserted.contentId}/composed.${extension}`;

  const uploaded = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, composed.buffer, {
      upsert: false,
      contentType
    });

  if (uploaded.error) {
    await deleteContentDraft({
      orgId: params.orgId,
      contentId: inserted.contentId
    });
    throw new HttpError(500, "storage_upload_failed", `Failed to upload instagram image: ${uploaded.error.message}`);
  }

  try {
    await updateContentStorageMetadata({
      orgId: params.orgId,
      contentId: inserted.contentId,
      storageBucket: STORAGE_BUCKET,
      storagePath,
      contentType,
      sizeBytes: composed.sizeBytes
    });
  } catch (error) {
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    await deleteContentDraft({ orgId: params.orgId, contentId: inserted.contentId });
    throw error;
  }

  try {
    await linkContentToSlot({
      orgId: params.orgId,
      slot: target.slot,
      contentId: inserted.contentId,
      source: target.source,
      idempotencyKey: params.idempotencyKey
    });
  } catch (error) {
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    await deleteContentDraft({ orgId: params.orgId, contentId: inserted.contentId });
    throw error;
  }

  const signed = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 30 * 60);
  const previewUrl = signed.data?.signedUrl ?? null;

  return {
    contentId: inserted.contentId,
    slotId: target.slot.id,
    source: target.source,
    topic: effectiveTopic,
    caption,
    model: llm.model,
    outputFormat,
    storagePath,
    previewUrl,
    templateId,
    selectedImagePaths: selected.selectedImages.map((entry) => entry.filePath),
    localSaveSuggestion: inserted.localSaveSuggestion,
    reused: false
  };
};

const normalizeTemplateId = (templateId: string | null): TemplateId =>
  templateId === "center-image-bottom-text" ||
  templateId === "fullscreen-overlay" ||
  templateId === "collage-2x2" ||
  templateId === "text-only-gradient" ||
  templateId === "split-image-text"
    ? templateId
    : DEFAULT_TEMPLATE_ID;

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
