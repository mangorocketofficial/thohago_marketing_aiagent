import { chunkBySourceType } from "@repo/rag";
import { getRagEmbedder, ragConfig, ragStore } from "../lib/rag";
import { supabaseAdmin } from "../lib/supabase-admin";
import { shouldRefreshInsightsByEmbeddedCount, updateAccumulatedInsights } from "./compute-insights";

const MIN_CONTENT_LENGTH = 10;
const INSIGHT_REFRESH_INTERVAL = 5;

export type ContentEmbeddingRow = {
  id: string;
  org_id: string;
  channel: string;
  content_type: string;
  status: string;
  body: string | null;
  campaign_id: string | null;
  published_at: string | null;
  created_by: string;
  metadata: Record<string, unknown> | null;
  embedded_at: string | null;
  created_at: string;
};

const EMBEDDING_COLUMNS =
  "id, org_id, channel, content_type, status, body, campaign_id, published_at, created_by, metadata, embedded_at, created_at";

const isEmbeddableStatus = (status: string): boolean => status === "published" || status === "historical";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const markContentEmbedded = async (orgId: string, contentId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("contents")
    .update({ embedded_at: new Date().toISOString() })
    .eq("id", contentId)
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to mark content embedded (${contentId}): ${error.message}`);
  }
};

const buildContentMetadata = (content: ContentEmbeddingRow): Record<string, unknown> => {
  const sourceMetadata = asRecord(content.metadata);
  const metadata: Record<string, unknown> = {
    channel: content.channel,
    content_type: content.content_type,
    campaign_id: content.campaign_id,
    published_at: content.published_at,
    created_by: content.created_by,
    origin: content.created_by === "onboarding_crawl" ? "onboarding_crawl" : "platform",
    performance_score: null
  };

  const originalUrl = readOptionalString(sourceMetadata.original_url);
  if (originalUrl) {
    metadata.original_url = originalUrl;
  }

  return metadata;
};

const maybeRefreshInsights = async (orgId: string): Promise<void> => {
  const shouldRefresh = await shouldRefreshInsightsByEmbeddedCount(orgId, INSIGHT_REFRESH_INTERVAL);
  if (!shouldRefresh) {
    return;
  }

  await updateAccumulatedInsights(orgId);
};

export const embedContent = async (
  orgId: string,
  content: ContentEmbeddingRow
): Promise<{ embedded: boolean; skipped: boolean; reason?: string }> => {
  if (content.org_id !== orgId) {
    throw new Error(`Content org mismatch. expected=${orgId}, actual=${content.org_id}`);
  }
  if (!isEmbeddableStatus(content.status)) {
    return {
      embedded: false,
      skipped: true,
      reason: "unsupported_status"
    };
  }

  const profile = ragConfig.defaultEmbeddingProfile;
  const body = content.body?.trim() ?? "";
  if (!body || body.length < MIN_CONTENT_LENGTH) {
    await ragStore.deleteBySource(orgId, "content", content.id, profile);
    await markContentEmbedded(orgId, content.id);
    return {
      embedded: false,
      skipped: true,
      reason: "short_body"
    };
  }

  const chunks = chunkBySourceType(body, {
    sourceType: "content",
    sourceId: content.id,
    metadata: buildContentMetadata(content)
  });
  if (!chunks.length) {
    await ragStore.deleteBySource(orgId, "content", content.id, profile);
    await markContentEmbedded(orgId, content.id);
    return {
      embedded: false,
      skipped: true,
      reason: "empty_chunk"
    };
  }

  const embedder = getRagEmbedder();
  const embeddings = await embedder.generateEmbeddings(
    chunks.map((chunk) => chunk.content),
    profile
  );

  await ragStore.replaceBySource(orgId, "content", content.id, chunks, embeddings, profile);
  await markContentEmbedded(orgId, content.id);

  try {
    await maybeRefreshInsights(orgId);
  } catch (error) {
    console.warn(
      `[INSIGHTS] Background update failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    embedded: true,
    skipped: false
  };
};

export const onContentPublished = async (orgId: string, contentId: string): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select(EMBEDDING_COLUMNS)
    .eq("id", contentId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load content for embedding (${contentId}): ${error.message}`);
  }
  if (!data) {
    console.warn(`[CONTENT_EMBED] Content not found. org=${orgId}, content=${contentId}`);
    return;
  }

  await embedContent(orgId, data as ContentEmbeddingRow);
};

const queryPendingContent = async (orgId: string, limit: number): Promise<ContentEmbeddingRow[]> => {
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select(EMBEDDING_COLUMNS)
    .eq("org_id", orgId)
    .in("status", ["published", "historical"])
    .is("embedded_at", null)
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to query pending content embeddings: ${error.message}`);
  }
  return (Array.isArray(data) ? data : []) as ContentEmbeddingRow[];
};

const countPendingContent = async (orgId: string): Promise<number> => {
  const { count, error } = await supabaseAdmin
    .from("contents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", ["published", "historical"])
    .is("embedded_at", null);

  if (error) {
    throw new Error(`Failed to count pending content embeddings: ${error.message}`);
  }

  return typeof count === "number" ? count : 0;
};

export const embedPendingContentBatch = async (
  orgId: string,
  batchLimit = 100
): Promise<{ embedded_count: number; failed_count: number; attempted_count: number; remaining: number }> => {
  const pendingRows = await queryPendingContent(orgId, batchLimit);
  if (!pendingRows.length) {
    return {
      embedded_count: 0,
      failed_count: 0,
      attempted_count: 0,
      remaining: 0
    };
  }

  let embeddedCount = 0;
  let failedCount = 0;

  for (const row of pendingRows) {
    try {
      await embedContent(orgId, row);
      embeddedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.warn(
        `[CONTENT_BACKFILL] Failed content embed. org=${orgId}, content=${row.id}, reason=${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    embedded_count: embeddedCount,
    failed_count: failedCount,
    attempted_count: pendingRows.length,
    remaining: await countPendingContent(orgId)
  };
};

export const embedAllPendingContent = async (
  orgId: string,
  options: { batchLimit?: number; maxBatches?: number } = {}
): Promise<{ embedded_count: number; failed_count: number; batches: number; remaining: number }> => {
  const batchLimit = Math.min(500, Math.max(1, Math.floor(options.batchLimit ?? 100)));
  const maxBatches = Math.max(1, Math.floor(options.maxBatches ?? 50));

  let totalEmbedded = 0;
  let totalFailed = 0;
  let batches = 0;
  let remaining = 0;

  while (batches < maxBatches) {
    const result = await embedPendingContentBatch(orgId, batchLimit);
    batches += 1;
    totalEmbedded += result.embedded_count;
    totalFailed += result.failed_count;
    remaining = result.remaining;

    if (result.attempted_count === 0 || result.remaining <= 0) {
      break;
    }
  }

  return {
    embedded_count: totalEmbedded,
    failed_count: totalFailed,
    batches,
    remaining
  };
};
