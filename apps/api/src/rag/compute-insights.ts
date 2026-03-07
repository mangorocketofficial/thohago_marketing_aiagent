import type { AccumulatedInsights, Channel } from "@repo/types";
import { supabaseAdmin } from "../lib/supabase-admin";
import {
  buildContentPatternSummary,
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  extractTopCtaPhrases,
  normalizeTimezone
} from "./performance-insight-helpers";

const PUBLISHED_STATUSES = ["published", "historical"] as const;
const CHANNELS: readonly Channel[] = ["instagram", "threads", "naver_blog", "facebook", "youtube"] as const;

type PublishedContentRow = {
  id: string;
  channel: Channel;
  body: string | null;
  published_at: string | null;
};

type LatestScoreRow = {
  content_id: string;
  performance_score: number | null;
  collected_at: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

/**
 * Resolve organization timezone from settings payload.
 */
const loadOrgTimezone = async (orgId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("org_brand_settings")
    .select("crawl_payload")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load org timezone: ${error.message}`);
  }

  const crawlPayload = asRecord(data?.crawl_payload);
  const timezone =
    typeof crawlPayload.timezone === "string"
      ? crawlPayload.timezone
      : typeof crawlPayload.time_zone === "string"
        ? crawlPayload.time_zone
        : null;
  return normalizeTimezone(timezone);
};

const countPublishedByChannel = async (orgId: string, channel: Channel): Promise<number> => {
  const { count, error } = await supabaseAdmin
    .from("contents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .eq("channel", channel);

  if (error) {
    throw new Error(`Failed to count contents for ${channel}: ${error.message}`);
  }
  return typeof count === "number" ? count : 0;
};

const loadPublishedContents = async (orgId: string): Promise<PublishedContentRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,channel,body,published_at")
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`Failed to load published contents: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const channel = typeof row.channel === "string" ? (row.channel.trim().toLowerCase() as Channel) : "";
      if (!id || !channel) {
        return null;
      }
      return {
        id,
        channel,
        body: typeof row.body === "string" ? row.body : null,
        published_at: typeof row.published_at === "string" ? row.published_at : null
      } satisfies PublishedContentRow;
    })
    .filter((row): row is PublishedContentRow => !!row);
};

const loadLatestScoresByContent = async (orgId: string, contentIds: string[]): Promise<Map<string, LatestScoreRow>> => {
  const byContent = new Map<string, LatestScoreRow>();
  for (const batch of chunkArray(contentIds, 500)) {
    const { data, error } = await supabaseAdmin
      .from("content_metrics")
      .select("content_id,performance_score,collected_at")
      .eq("org_id", orgId)
      .in("content_id", batch)
      .order("collected_at", { ascending: false })
      .limit(Math.max(batch.length * 8, 100));

    if (error) {
      throw new Error(`Failed to load content metric rows: ${error.message}`);
    }

    for (const row of Array.isArray(data) ? data : []) {
      const contentId = typeof row.content_id === "string" ? row.content_id.trim() : "";
      const collectedAt = typeof row.collected_at === "string" ? row.collected_at : "";
      if (!contentId || !collectedAt) {
        continue;
      }

      const existing = byContent.get(contentId);
      if (existing && existing.collected_at >= collectedAt) {
        continue;
      }
      byContent.set(contentId, {
        content_id: contentId,
        performance_score: readNumber(row.performance_score),
        collected_at: collectedAt
      });
    }
  }
  return byContent;
};

const summarizeEditPreferences = async (orgId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("org_rag_embeddings")
    .select("metadata")
    .eq("org_id", orgId)
    .eq("source_type", "chat_pattern")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Failed to load chat pattern metadata: ${error.message}`);
  }

  const editTypeCounts: Record<string, number> = {};
  for (const row of Array.isArray(data) ? data : []) {
    const metadata = asRecord(row?.metadata);
    const editType = typeof metadata.edit_type === "string" ? metadata.edit_type.trim() : "";
    if (!editType) {
      continue;
    }
    editTypeCounts[editType] = (editTypeCounts[editType] ?? 0) + 1;
  }

  const total = Object.values(editTypeCounts).reduce((sum, count) => sum + count, 0);
  if (!total) {
    return "";
  }
  const parts = Object.entries(editTypeCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}: ${count}`);
  return `Total ${total} edit patterns (${parts.join(", ")})`;
};

/**
 * Compute accumulated performance insights for AI memory.
 */
export const computeInsights = async (orgId: string): Promise<AccumulatedInsights> => {
  const generatedAt = new Date().toISOString();
  const timezone = await loadOrgTimezone(orgId);
  const published = await loadPublishedContents(orgId);

  const countEntries = await Promise.all(
    CHANNELS.map(async (channel) => [channel, await countPublishedByChannel(orgId, channel)] as const)
  );
  const channelCounts: Record<string, number> = {};
  for (const [channel, count] of countEntries) {
    if (count > 0) {
      channelCounts[channel] = count;
    }
  }

  const latestScoresByContent = await loadLatestScoresByContent(
    orgId,
    published.map((content) => content.id)
  );

  const mergedRows = published.map((content) => ({
    channel: content.channel,
    body: content.body,
    published_at: content.published_at,
    performance_score: latestScoresByContent.get(content.id)?.performance_score ?? null
  }));

  const scoreSumByChannel: Record<string, number> = {};
  const scoreCountByChannel: Record<string, number> = {};
  for (const row of mergedRows) {
    if (typeof row.performance_score !== "number" || !Number.isFinite(row.performance_score)) {
      continue;
    }
    scoreSumByChannel[row.channel] = (scoreSumByChannel[row.channel] ?? 0) + row.performance_score;
    scoreCountByChannel[row.channel] = (scoreCountByChannel[row.channel] ?? 0) + 1;
  }

  const avgScores: Record<string, number> = {};
  for (const [channel, sum] of Object.entries(scoreSumByChannel)) {
    const count = scoreCountByChannel[channel] ?? 0;
    if (count > 0) {
      avgScores[channel] = sum / count;
    }
  }

  return {
    best_publish_times: computeBestPublishTimes(mergedRows, timezone),
    top_cta_phrases: extractTopCtaPhrases(mergedRows, 5),
    content_pattern_summary: buildContentPatternSummary(channelCounts),
    channel_recommendations: buildPerformanceAwareRecommendations(channelCounts, avgScores, scoreCountByChannel),
    user_edit_preference_summary: await summarizeEditPreferences(orgId),
    generated_at: generatedAt,
    content_count_at_generation: published.length
  };
};

/**
 * Persist computed insights to org_brand_settings.
 */
export const updateAccumulatedInsights = async (orgId: string): Promise<void> => {
  const insights = await computeInsights(orgId);
  const { error } = await supabaseAdmin
    .from("org_brand_settings")
    .update({ accumulated_insights: insights })
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to update accumulated insights: ${error.message}`);
  }
};

/**
 * Trigger periodic refresh every N embedded published content rows.
 */
export const shouldRefreshInsightsByEmbeddedCount = async (orgId: string, every = 5): Promise<boolean> => {
  const refreshEvery = Math.max(1, Math.floor(every));
  const { count, error } = await supabaseAdmin
    .from("contents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .not("embedded_at", "is", null);

  if (error) {
    throw new Error(`Failed to count embedded published contents: ${error.message}`);
  }
  const total = typeof count === "number" ? count : 0;
  return total > 0 && total % refreshEvery === 0;
};

export { computeBestPublishTimes, extractTopCtaPhrases, buildPerformanceAwareRecommendations };
