import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { asRecord, asString, type InstagramGenerationResult, type ScheduleSlotRow, type SlotSource } from "./types";

type ImageSelectionSource = "manual_selection" | "index_activity_folder" | "index_org_fallback" | "recency_fallback" | "none";

const sanitizePathSegment = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 72);

  return cleaned || fallback;
};

const normalizeImageSelectionSource = (value: unknown, fallback: ImageSelectionSource): ImageSelectionSource => {
  const normalized = asString(value, "").trim();
  if (
    normalized === "manual_selection" ||
    normalized === "index_activity_folder" ||
    normalized === "index_org_fallback" ||
    normalized === "recency_fallback" ||
    normalized === "none"
  ) {
    return normalized;
  }
  return fallback;
};

const asStringMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const id = key.trim();
    if (!id) {
      continue;
    }
    const text = asString(entry, "").trim();
    if (!text) {
      continue;
    }
    result[id] = text;
  }
  return result;
};

const buildLocalSaveSuggestion = (params: {
  source: SlotSource;
  topic: string;
  scheduledDate: string;
  campaignTitle: string | null;
  outputFormat: "png" | "jpg";
}): { relativePath: string; fileName: string } => {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(params.scheduledDate)
    ? params.scheduledDate
    : new Date().toISOString().slice(0, 10);
  const topicPart = sanitizePathSegment(params.topic, "instagram-post").replace(/\s+/g, "-").toLowerCase();
  const relativePath =
    params.source === "campaign"
      ? `contents/${sanitizePathSegment(params.campaignTitle ?? "campaign", "campaign")}`
      : "contents/ondemand";

  return {
    relativePath,
    fileName: `${datePart}_instagram_${topicPart}.${params.outputFormat}`
  };
};

export const loadCampaignTitle = async (params: { orgId: string; campaignId: string | null }): Promise<string | null> => {
  if (!params.campaignId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("title")
    .eq("org_id", params.orgId)
    .eq("id", params.campaignId)
    .maybeSingle();

  if (error) {
    console.warn(`[INSTAGRAM_SKILL] Failed to load campaign title: ${error.message}`);
    return null;
  }

  const title = asString(asRecord(data).title, "").trim();
  return title || null;
};

export const loadExistingGeneratedResult = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  source: SlotSource;
  topic: string;
}): Promise<InstagramGenerationResult | null> => {
  if (!params.slot.content_id) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,body,metadata")
    .eq("org_id", params.orgId)
    .eq("id", params.slot.content_id)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load existing instagram content: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const row = asRecord(data);
  const metadata = asRecord(row.metadata);
  const localSave = asRecord(metadata.local_save_suggestion);
  const outputFormat = asString(metadata.output_format, "").toLowerCase() === "jpg" ? "jpg" : "png";
  const imageFileIds = Array.isArray(metadata.image_file_ids)
    ? metadata.image_file_ids.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const overlayTexts = asStringMap(metadata.overlay_texts);

  return {
    contentId: asString(row.id, ""),
    slotId: params.slot.id,
    source: params.source,
    topic: asString(metadata.topic, params.topic) || params.topic,
    caption: asString(row.body, ""),
    model: asString(metadata.generation_model, "claude") === "gpt-4o-mini" ? "gpt-4o-mini" : "claude",
    templateId: asString(metadata.template_id, "koica_cover_01"),
    overlayTexts,
    imageFileIds,
    selectedImagePaths: Array.isArray(metadata.image_paths)
      ? metadata.image_paths.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    imageSelectionSource: normalizeImageSelectionSource(
      metadata.image_selection_source,
      imageFileIds.length > 0 ? "index_activity_folder" : "none"
    ),
    imageSelectionReason: asString(metadata.image_selection_reason, "").trim() || null,
    requiresLocalCompose: true,
    localSaveSuggestion: {
      relativePath: asString(localSave.relative_path, "contents/ondemand"),
      fileName: asString(localSave.file_name, `instagram.${outputFormat}`)
    },
    reused: true
  };
};

/**
 * Insert draft instagram content row with local-compose seed metadata.
 */
export const insertDraftInstagramContent = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  source: SlotSource;
  activityFolder: string;
  topic: string;
  caption: string;
  hashtags: string[];
  overlayTexts: Record<string, string>;
  templateId: string;
  selectedImageFileIds: string[];
  selectedImagePaths: string[];
  imageSelectionSource: ImageSelectionSource;
  imageSelectionReason: string | null;
  model: "claude" | "gpt-4o-mini";
  promptTokens: number | null;
  completionTokens: number | null;
  idempotencyKey: string | null;
  outputFormat: "png" | "jpg";
  campaignTitle: string | null;
}): Promise<{ contentId: string; localSaveSuggestion: { relativePath: string; fileName: string } }> => {
  const localSaveSuggestion = buildLocalSaveSuggestion({
    source: params.source,
    topic: params.topic,
    scheduledDate: params.slot.scheduled_date,
    campaignTitle: params.campaignTitle,
    outputFormat: params.outputFormat
  });

  const scheduledAt = /^\d{4}-\d{2}-\d{2}$/.test(params.slot.scheduled_date)
    ? `${params.slot.scheduled_date}T09:00:00.000Z`
    : null;

  const { data, error } = await supabaseAdmin
    .from("contents")
    .insert({
      org_id: params.orgId,
      campaign_id: params.slot.campaign_id,
      channel: "instagram",
      content_type: "image",
      status: "draft",
      body: params.caption,
      metadata: {
        generation_model: params.model,
        generation_tokens: {
          prompt: params.promptTokens,
          completion: params.completionTokens
        },
        topic: params.topic,
        source: params.source,
        activity_folder: params.activityFolder,
        campaign_id: params.slot.campaign_id,
        hashtags: params.hashtags,
        template_id: params.templateId,
        overlay_texts: params.overlayTexts,
        image_file_ids: params.selectedImageFileIds,
        image_paths: params.selectedImagePaths,
        image_selection_source: params.imageSelectionSource,
        image_selection_reason: params.imageSelectionReason,
        output_format: params.outputFormat,
        composed_locally: true,
        local_save_suggestion: {
          relative_path: localSaveSuggestion.relativePath,
          file_name: localSaveSuggestion.fileName,
          encoding: "binary"
        },
        request_idempotency_key: params.idempotencyKey
      },
      scheduled_at: scheduledAt,
      created_by: "ai"
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to insert instagram draft content: ${error?.message ?? "unknown"}`);
  }

  const contentId = asString(asRecord(data).id, "").trim();
  if (!contentId) {
    throw new HttpError(500, "db_error", "Failed to resolve content id.");
  }

  return {
    contentId,
    localSaveSuggestion
  };
};

/**
 * Link slot to generated content.
 */
export const linkContentToSlot = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  contentId: string;
  source: SlotSource;
  idempotencyKey: string | null;
}): Promise<void> => {
  const nextMetadata = {
    ...params.slot.metadata,
    source: params.source,
    generated_content_id: params.contentId,
    generation_completed_at: new Date().toISOString(),
    request_idempotency_key: params.idempotencyKey
  };

  const { data, error } = await supabaseAdmin
    .from("schedule_slots")
    .update({
      content_id: params.contentId,
      slot_status: "pending_approval",
      lock_version: params.slot.lock_version + 1,
      metadata: nextMetadata
    })
    .eq("org_id", params.orgId)
    .eq("id", params.slot.id)
    .eq("lock_version", params.slot.lock_version)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new HttpError(409, "version_conflict", `Failed to link content to slot: ${error?.message ?? "conflict"}`);
  }
};

export const deleteContentDraft = async (params: { orgId: string; contentId: string }): Promise<void> => {
  await supabaseAdmin.from("contents").delete().eq("org_id", params.orgId).eq("id", params.contentId);
};

/**
 * Mark generating slot as failed when instagram generation pipeline aborts.
 * Best-effort only; failure should not hide the original error.
 */
export const markSlotGenerationFailed = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  reason: string;
}): Promise<void> => {
  const nextMetadata = {
    ...params.slot.metadata,
    generation_failed_at: new Date().toISOString(),
    generation_error: params.reason.slice(0, 500)
  };

  const { error } = await supabaseAdmin
    .from("schedule_slots")
    .update({
      slot_status: "failed",
      metadata: nextMetadata
    })
    .eq("org_id", params.orgId)
    .eq("id", params.slot.id)
    .eq("slot_status", "generating")
    .is("content_id", null);

  if (error) {
    console.warn(`[INSTAGRAM_SKILL] Failed to mark slot as failed: ${error.message}`);
  }
};
