import type {
  AccumulatedInsights,
  Campaign,
  CampaignPlan,
  CampaignPlanSchedule,
  CampaignStatus,
  OrgBrandSettings,
  RagIngestionStatus
} from "@repo/rag";
import { HttpError } from "../lib/errors";
import { supabaseAdmin } from "../lib/supabase-admin";

const DEFAULT_CRAWL_STATUS = {
  state: "idle",
  started_at: null,
  finished_at: null,
  sources: {
    website: { source: "website", url: "", status: "pending", started_at: null, finished_at: null, error: null, data: null },
    naver_blog: {
      source: "naver_blog",
      url: "",
      status: "pending",
      started_at: null,
      finished_at: null,
      error: null,
      data: null
    },
    instagram: { source: "instagram", url: "", status: "pending", started_at: null, finished_at: null, error: null, data: null }
  }
} as OrgBrandSettings["crawl_status"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const readRequiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(500, "db_error", `Missing required string field: ${field}`);
  }
  return value.trim();
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

const readNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const readInteger = (value: unknown, fallback = 0): number => {
  const numeric = readNumber(value, fallback);
  return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
};

const readBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
};

const readStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.trim() || typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    output[key] = entry;
  }
  return output;
};

const toScheduleRows = (value: unknown): CampaignPlanSchedule[] =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          const row = toRecord(entry);
          const day = Math.max(1, Math.floor(readNumber(row.day, 1)));
          const channel = readOptionalString(row.channel) ?? "unknown";
          const type = readOptionalString(row.type) ?? "general";
          return {
            day,
            channel,
            type
          } satisfies CampaignPlanSchedule;
        })
        .filter(Boolean)
    : [];

const readCampaignPlan = (value: unknown): CampaignPlan => {
  const row = toRecord(value);
  return {
    objective: readOptionalString(row.objective) ?? "미정",
    channels: readStringArray(row.channels),
    duration_days: Math.max(1, Math.floor(readNumber(row.duration_days, 7))),
    post_count: Math.max(0, Math.floor(readNumber(row.post_count, 0))),
    content_types: readStringArray(row.content_types),
    suggested_schedule: toScheduleRows(row.suggested_schedule)
  };
};

const readCampaignStatus = (value: unknown): CampaignStatus => {
  const status = readOptionalString(value);
  if (status === "draft" || status === "approved" || status === "active" || status === "completed" || status === "cancelled") {
    return status;
  }
  return "draft";
};

const readRagIngestionStatus = (value: unknown): RagIngestionStatus => {
  const status = readOptionalString(value);
  if (status === "pending" || status === "processing" || status === "done" || status === "failed") {
    return status;
  }
  return "pending";
};

const readInterviewAnswers = (value: unknown): OrgBrandSettings["interview_answers"] => {
  const row = toRecord(value);
  return {
    q1: readOptionalString(row.q1) ?? "",
    q2: readOptionalString(row.q2) ?? "",
    q3: readOptionalString(row.q3) ?? "",
    q4: readOptionalString(row.q4) ?? ""
  };
};

export const parseAccumulatedInsights = (value: unknown): AccumulatedInsights | null => {
  const row = toRecord(value);
  const generatedAt = readOptionalString(row.generated_at);
  if (!generatedAt) {
    return null;
  }

  const bestPublishTimes = readStringRecord(row.best_publish_times);
  const channelRecommendations = readStringRecord(row.channel_recommendations);

  return {
    best_publish_times: bestPublishTimes,
    top_cta_phrases: readStringArray(row.top_cta_phrases),
    content_pattern_summary: readOptionalString(row.content_pattern_summary) ?? "",
    channel_recommendations: channelRecommendations,
    user_edit_preference_summary: readOptionalString(row.user_edit_preference_summary) ?? "",
    generated_at: generatedAt,
    content_count_at_generation: Math.max(0, Math.floor(readNumber(row.content_count_at_generation, 0)))
  };
};

export const readReviewMarkdown = (brandSettings: OrgBrandSettings): string => {
  const document = toRecord(brandSettings.result_document);
  const markdown = readOptionalString(document.review_markdown);
  return markdown ?? "";
};

const toOrgBrandSettings = (value: Record<string, unknown>): OrgBrandSettings => ({
  org_id: readRequiredString(value.org_id, "org_id"),
  website_url: readOptionalString(value.website_url),
  naver_blog_url: readOptionalString(value.naver_blog_url),
  instagram_url: readOptionalString(value.instagram_url),
  facebook_url: readOptionalString(value.facebook_url),
  youtube_url: readOptionalString(value.youtube_url),
  threads_url: readOptionalString(value.threads_url),
  crawl_status: (isRecord(value.crawl_status) ? value.crawl_status : DEFAULT_CRAWL_STATUS) as OrgBrandSettings["crawl_status"],
  crawl_payload: toRecord(value.crawl_payload),
  interview_answers: readInterviewAnswers(value.interview_answers),
  detected_tone: readOptionalString(value.detected_tone),
  tone_description: readOptionalString(value.tone_description),
  target_audience: readStringArray(value.target_audience),
  key_themes: readStringArray(value.key_themes),
  forbidden_words: readStringArray(value.forbidden_words),
  forbidden_topics: readStringArray(value.forbidden_topics),
  campaign_seasons: readStringArray(value.campaign_seasons),
  brand_summary: readOptionalString(value.brand_summary),
  result_document: isRecord(value.result_document) ? value.result_document : null,
  memory_md: readOptionalString(value.memory_md),
  memory_md_generated_at: readOptionalString(value.memory_md_generated_at),
  memory_freshness_key: readOptionalString(value.memory_freshness_key),
  rag_indexed_at: readOptionalString(value.rag_indexed_at),
  rag_source_hash: readOptionalString(value.rag_source_hash),
  accumulated_insights: isRecord(value.accumulated_insights) ? value.accumulated_insights : {},
  rag_ingestion_status: readRagIngestionStatus(value.rag_ingestion_status),
  rag_ingestion_started_at: readOptionalString(value.rag_ingestion_started_at),
  rag_ingestion_error: readOptionalString(value.rag_ingestion_error),
  created_at: readOptionalString(value.created_at) ?? new Date(0).toISOString(),
  updated_at: readOptionalString(value.updated_at) ?? new Date(0).toISOString()
});

const toCampaign = (value: Record<string, unknown>): Campaign => ({
  id: readRequiredString(value.id, "campaign.id"),
  org_id: readRequiredString(value.org_id, "campaign.org_id"),
  title: readOptionalString(value.title) ?? "Untitled campaign",
  activity_folder: readOptionalString(value.activity_folder) ?? "",
  status: readCampaignStatus(value.status),
  channels: readStringArray(value.channels),
  plan: readCampaignPlan(value.plan),
  created_at: readOptionalString(value.created_at) ?? new Date(0).toISOString(),
  updated_at: readOptionalString(value.updated_at) ?? new Date(0).toISOString()
});

export const loadOrgBrandSettings = async (orgId: string): Promise<OrgBrandSettings | null> => {
  const { data, error } = await supabaseAdmin.from("org_brand_settings").select("*").eq("org_id", orgId).maybeSingle();
  if (error) {
    throw new HttpError(500, "db_error", `Failed to load org brand settings: ${error.message}`);
  }
  if (!data || !isRecord(data)) {
    return null;
  }
  return toOrgBrandSettings(data);
};

export const loadActiveCampaigns = async (orgId: string): Promise<Campaign[]> => {
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .select("id, org_id, title, activity_folder, status, channels, plan, created_at, updated_at")
    .eq("org_id", orgId)
    .in("status", ["draft", "approved", "active"])
    .order("updated_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load active campaigns: ${error.message}`);
  }

  return (Array.isArray(data) ? data : []).filter(isRecord).map(toCampaign);
};

export type FolderDocumentExtract = {
  source_id: string;
  file_name: string;
  activity_folder: string;
  content: string;
  chunk_count: number;
  created_at: string | null;
};

type FolderDocumentExtractQueryParams = {
  orgId: string;
  activityFolder: string;
  limitDocs?: number;
  maxChunksPerDoc?: number;
  rowLimit?: number;
};

type FolderDocumentChunk = {
  chunk_index: number;
  content: string;
  created_at: string | null;
};

const parseIsoTime = (value: string | null): number => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getDocumentExtractsByFolder = async (
  params: FolderDocumentExtractQueryParams
): Promise<FolderDocumentExtract[]> => {
  const orgId = params.orgId.trim();
  const activityFolder = params.activityFolder.trim();
  if (!orgId || !activityFolder) {
    return [];
  }

  const limitDocs =
    typeof params.limitDocs === "number" && Number.isFinite(params.limitDocs)
      ? Math.max(1, Math.min(10, Math.floor(params.limitDocs)))
      : 3;
  const maxChunksPerDoc =
    typeof params.maxChunksPerDoc === "number" && Number.isFinite(params.maxChunksPerDoc)
      ? Math.max(1, Math.min(20, Math.floor(params.maxChunksPerDoc)))
      : 8;
  const rowLimit =
    typeof params.rowLimit === "number" && Number.isFinite(params.rowLimit)
      ? Math.max(limitDocs * maxChunksPerDoc, Math.floor(params.rowLimit))
      : Math.max(120, limitDocs * maxChunksPerDoc * 8);

  const { data, error } = await supabaseAdmin
    .from("org_rag_embeddings")
    .select("source_id, chunk_index, content, metadata, created_at")
    .eq("org_id", orgId)
    .eq("source_type", "local_doc")
    .contains("metadata", { activity_folder: activityFolder })
    .order("created_at", { ascending: false })
    .limit(rowLimit);

  if (error) {
    throw new HttpError(500, "db_error", `Failed to load folder document extracts: ${error.message}`);
  }

  const grouped = new Map<
    string,
    {
      source_id: string;
      file_name: string;
      activity_folder: string;
      chunks: FolderDocumentChunk[];
      latest_created_at: string | null;
    }
  >();

  for (const row of Array.isArray(data) ? data : []) {
    if (!isRecord(row)) {
      continue;
    }
    const sourceId = readOptionalString(row.source_id);
    if (!sourceId) {
      continue;
    }

    const metadata = toRecord(row.metadata);
    if (!readBoolean(metadata.text_extracted, false)) {
      continue;
    }

    const chunkContent = readOptionalString(row.content);
    if (!chunkContent) {
      continue;
    }

    const fileName = readOptionalString(metadata.file_name) ?? sourceId;
    const rowActivityFolder = readOptionalString(metadata.activity_folder) ?? activityFolder;
    const createdAt = readOptionalString(row.created_at);
    const chunkIndex = Math.max(0, readInteger(row.chunk_index, 0));

    const existing = grouped.get(sourceId);
    if (!existing) {
      grouped.set(sourceId, {
        source_id: sourceId,
        file_name: fileName,
        activity_folder: rowActivityFolder,
        chunks: [{ chunk_index: chunkIndex, content: chunkContent, created_at: createdAt }],
        latest_created_at: createdAt
      });
      continue;
    }

    existing.chunks.push({ chunk_index: chunkIndex, content: chunkContent, created_at: createdAt });
    if (parseIsoTime(createdAt) > parseIsoTime(existing.latest_created_at)) {
      existing.latest_created_at = createdAt;
    }
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const timeDiff = parseIsoTime(right.latest_created_at) - parseIsoTime(left.latest_created_at);
      return timeDiff !== 0 ? timeDiff : left.file_name.localeCompare(right.file_name);
    })
    .slice(0, limitDocs)
    .map((entry) => {
      const orderedChunks = [...entry.chunks]
        .sort((left, right) => {
          if (left.chunk_index !== right.chunk_index) {
            return left.chunk_index - right.chunk_index;
          }
          return parseIsoTime(left.created_at) - parseIsoTime(right.created_at);
        })
        .slice(0, maxChunksPerDoc);

      return {
        source_id: entry.source_id,
        file_name: entry.file_name,
        activity_folder: entry.activity_folder,
        content: orderedChunks.map((chunk) => chunk.content).join("\n\n"),
        chunk_count: orderedChunks.length,
        created_at: entry.latest_created_at
      };
    })
    .filter((entry) => !!entry.content.trim());
};
