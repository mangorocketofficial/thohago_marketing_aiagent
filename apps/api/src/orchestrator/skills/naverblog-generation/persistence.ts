import { HttpError } from "../../../lib/errors";
import { supabaseAdmin } from "../../../lib/supabase-admin";
import { asRecord, asString, type BlogGenerationResult, type ScheduleSlotRow, type SlotSource } from "./types";

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
}): { relativePath: string; fileName: string } => {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(params.scheduledDate)
    ? params.scheduledDate
    : new Date().toISOString().slice(0, 10);
  const topicPart = sanitizePathSegment(params.topic, "blog-post").replace(/\s+/g, "-").toLowerCase();

  const relativePath =
    params.source === "campaign"
      ? `contents/${sanitizePathSegment(params.campaignTitle ?? "campaign", "campaign")}`
      : "contents/ondemand";

  return {
    relativePath,
    fileName: `${datePart}_naver-blog_${topicPart}.md`
  };
};

const extractHashtags = (value: string): string[] => {
  const matches = value.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  const deduped = [...new Set(matches.map((entry) => entry.trim()).filter(Boolean))];
  return deduped.slice(0, 10);
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
    console.warn(`[NAVER_BLOG_SKILL] Failed to load campaign title: ${error.message}`);
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
}): Promise<BlogGenerationResult | null> => {
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
    throw new HttpError(500, "db_error", `Failed to load existing generated content: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const row = asRecord(data);
  const metadata = asRecord(row.metadata);
  const localSave = asRecord(metadata.local_save_suggestion);
  const tokenMeta = asRecord(metadata.generation_tokens);

  return {
    contentId: asString(row.id, ""),
    slotId: params.slot.id,
    source: params.source,
    topic: asString(metadata.topic, params.topic) || params.topic,
    body: asString(row.body, ""),
    model: asString(metadata.generation_model, "claude") === "gpt-4o-mini" ? "gpt-4o-mini" : "claude",
    tokens: {
      prompt: typeof tokenMeta.prompt === "number" ? tokenMeta.prompt : null,
      completion: typeof tokenMeta.completion === "number" ? tokenMeta.completion : null
    },
    localSaveSuggestion: {
      relativePath: asString(localSave.relative_path, "contents/ondemand"),
      fileName: asString(localSave.file_name, "blog-post.md")
    },
    reused: true
  };
};

/**
 * Persist generated blog content and atomically link it to the reserved slot via rollback-on-failure.
 */
export const persistGeneratedContent = async (params: {
  orgId: string;
  slot: ScheduleSlotRow;
  source: SlotSource;
  topic: string;
  body: string;
  model: "claude" | "gpt-4o-mini";
  promptTokens: number | null;
  completionTokens: number | null;
  idempotencyKey: string | null;
  campaignTitle: string | null;
}): Promise<BlogGenerationResult> => {
  const hashtags = extractHashtags(params.body);
  const localSaveSuggestion = buildLocalSaveSuggestion({
    source: params.source,
    topic: params.topic,
    scheduledDate: params.slot.scheduled_date,
    campaignTitle: params.campaignTitle
  });

  const scheduledAt = /^\d{4}-\d{2}-\d{2}$/.test(params.slot.scheduled_date)
    ? `${params.slot.scheduled_date}T09:00:00.000Z`
    : null;

  const { data: content, error: contentError } = await supabaseAdmin
    .from("contents")
    .insert({
      org_id: params.orgId,
      campaign_id: params.slot.campaign_id,
      channel: "naver_blog",
      content_type: "text",
      status: "draft",
      body: params.body,
      metadata: {
        generation_model: params.model,
        generation_tokens: {
          prompt: params.promptTokens,
          completion: params.completionTokens
        },
        topic: params.topic,
        source: params.source,
        campaign_id: params.slot.campaign_id,
        hashtags,
        local_save_suggestion: {
          relative_path: localSaveSuggestion.relativePath,
          file_name: localSaveSuggestion.fileName,
          encoding: "utf8"
        },
        request_idempotency_key: params.idempotencyKey
      },
      scheduled_at: scheduledAt,
      created_by: "ai"
    })
    .select("id")
    .single();

  if (contentError || !content) {
    throw new HttpError(500, "db_error", `Failed to save generated content: ${contentError?.message ?? "unknown"}`);
  }

  const contentId = asString(asRecord(content).id, "").trim();
  if (!contentId) {
    throw new HttpError(500, "db_error", "Failed to resolve generated content id.");
  }

  const nextMetadata = {
    ...params.slot.metadata,
    source: params.source,
    generated_content_id: contentId,
    generation_model: params.model,
    generation_completed_at: new Date().toISOString(),
    request_idempotency_key: params.idempotencyKey
  };

  const { data: linkedSlot, error: slotError } = await supabaseAdmin
    .from("schedule_slots")
    .update({
      content_id: contentId,
      slot_status: "pending_approval",
      lock_version: params.slot.lock_version + 1,
      title: params.slot.title || params.topic,
      metadata: nextMetadata
    })
    .eq("org_id", params.orgId)
    .eq("id", params.slot.id)
    .eq("lock_version", params.slot.lock_version)
    .select("id")
    .maybeSingle();

  if (slotError || !linkedSlot) {
    await supabaseAdmin.from("contents").delete().eq("org_id", params.orgId).eq("id", contentId);
    if (slotError) {
      throw new HttpError(500, "db_error", `Failed to link generated content to slot: ${slotError.message}`);
    }
    throw new HttpError(409, "version_conflict", "Failed to link generated content due to slot version conflict.");
  }

  return {
    contentId,
    slotId: params.slot.id,
    source: params.source,
    topic: params.topic,
    body: params.body,
    model: params.model,
    tokens: {
      prompt: params.promptTokens,
      completion: params.completionTokens
    },
    localSaveSuggestion,
    reused: false
  };
};
