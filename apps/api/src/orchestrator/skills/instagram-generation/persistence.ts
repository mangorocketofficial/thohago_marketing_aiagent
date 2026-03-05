import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { asRecord, asString, type InstagramGenerationResult, type ScheduleSlotRow, type SlotSource } from "./types";

const sanitizePathSegment = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 72);

  return cleaned || fallback;
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
  const storage = asRecord(metadata.composed_image_storage);
  const localSave = asRecord(metadata.local_save_suggestion);
  const outputFormat = asString(storage.content_type, "").includes("jpeg") ? "jpg" : "png";

  return {
    contentId: asString(row.id, ""),
    slotId: params.slot.id,
    source: params.source,
    topic: asString(metadata.topic, params.topic) || params.topic,
    caption: asString(row.body, ""),
    model: asString(metadata.generation_model, "claude") === "gpt-4o-mini" ? "gpt-4o-mini" : "claude",
    outputFormat,
    storagePath: asString(storage.path, ""),
    previewUrl: null,
    templateId: asString(metadata.template_id, "center-image-bottom-text"),
    selectedImagePaths: Array.isArray(metadata.image_paths)
      ? metadata.image_paths.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    localSaveSuggestion: {
      relativePath: asString(localSave.relative_path, "contents/ondemand"),
      fileName: asString(localSave.file_name, `instagram.${outputFormat}`)
    },
    reused: true
  };
};

/**
 * Insert draft content row before storage upload.
 */
export const insertDraftInstagramContent = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  source: SlotSource;
  topic: string;
  caption: string;
  hashtags: string[];
  overlayMain: string;
  overlaySub: string;
  templateId: string;
  selectedImagePaths: string[];
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
        campaign_id: params.slot.campaign_id,
        hashtags: params.hashtags,
        template_id: params.templateId,
        overlay_main: params.overlayMain,
        overlay_sub: params.overlaySub,
        image_paths: params.selectedImagePaths,
        output_format: params.outputFormat,
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
 * Update content metadata with storage path and size.
 */
export const updateContentStorageMetadata = async (params: {
  orgId: string;
  contentId: string;
  storageBucket: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}): Promise<void> => {
  const { data: row, error: readError } = await supabaseAdmin
    .from("contents")
    .select("metadata")
    .eq("org_id", params.orgId)
    .eq("id", params.contentId)
    .maybeSingle();

  if (readError || !row) {
    throw new HttpError(500, "db_error", `Failed to read content metadata before update: ${readError?.message ?? "missing"}`);
  }

  const currentMetadata = asRecord(asRecord(row).metadata);
  const { data, error } = await supabaseAdmin
    .from("contents")
    .update({
      metadata: {
        ...currentMetadata,
        composed_image_size: params.sizeBytes,
        composed_image_storage: {
          bucket: params.storageBucket,
          path: params.storagePath,
          content_type: params.contentType
        }
      }
    })
    .eq("org_id", params.orgId)
    .eq("id", params.contentId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new HttpError(500, "db_error", `Failed to update content storage metadata: ${error?.message ?? "conflict"}`);
  }
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
      slot_status: "draft",
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
