import type { Channel } from "@repo/types";
import { supabaseAdmin } from "../lib/supabase-admin";

const PUBLISHED_STATUSES = ["published", "historical"] as const;
const MAX_ANALYSIS_CONTENT_ROWS = 5000;
const MAX_METRIC_ROWS_PER_BATCH = 4000;

type PublishedContentRow = {
  id: string;
  channel: Channel;
  body: string | null;
  published_at: string | null;
  created_at: string;
};

export type LatestMetricsSnapshot = {
  content_id: string;
  likes: number | null;
  views: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follower_delta: number | null;
  performance_score: number | null;
  collected_at: string;
};

export type AnalysisContentRow = PublishedContentRow & {
  metrics: LatestMetricsSnapshot;
  performance_score: number;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const nextSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += nextSize) {
    chunks.push(items.slice(index, index + nextSize));
  }
  return chunks;
};

const readOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

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

const toPublishedContentRow = (value: Record<string, unknown>): PublishedContentRow | null => {
  const id = readOptionalString(value.id);
  const channel = readOptionalString(value.channel) as Channel | null;
  if (!id || !channel) {
    return null;
  }

  return {
    id,
    channel,
    body: readOptionalString(value.body),
    published_at: readOptionalString(value.published_at),
    created_at: readOptionalString(value.created_at) ?? new Date(0).toISOString()
  };
};

const toLatestMetricsSnapshot = (value: Record<string, unknown>): LatestMetricsSnapshot | null => {
  const contentId = readOptionalString(value.content_id);
  const collectedAt = readOptionalString(value.collected_at);
  if (!contentId || !collectedAt) {
    return null;
  }

  return {
    content_id: contentId,
    likes: readNumber(value.likes),
    views: readNumber(value.views),
    comments: readNumber(value.comments),
    shares: readNumber(value.shares),
    saves: readNumber(value.saves),
    follower_delta: readNumber(value.follower_delta),
    performance_score: readNumber(value.performance_score),
    collected_at: collectedAt
  };
};

const loadPublishedContents = async (orgId: string): Promise<PublishedContentRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("contents")
    .select("id,channel,body,published_at,created_at")
    .eq("org_id", orgId)
    .in("status", [...PUBLISHED_STATUSES])
    .order("created_at", { ascending: false })
    .limit(MAX_ANALYSIS_CONTENT_ROWS);

  if (error) {
    throw new Error(`Failed to load published contents for analysis: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => (row && typeof row === "object" ? toPublishedContentRow(row as Record<string, unknown>) : null))
    .filter((row): row is PublishedContentRow => !!row);
};

const loadLatestMetricsByContent = async (orgId: string, contentIds: string[]): Promise<Map<string, LatestMetricsSnapshot>> => {
  const byContent = new Map<string, LatestMetricsSnapshot>();

  for (const batch of chunkArray(contentIds, 500)) {
    const { data, error } = await supabaseAdmin
      .from("content_metrics")
      .select("content_id,likes,views,comments,shares,saves,follower_delta,performance_score,collected_at")
      .eq("org_id", orgId)
      .in("content_id", batch)
      .order("collected_at", { ascending: false })
      .limit(Math.max(batch.length * 8, MAX_METRIC_ROWS_PER_BATCH));

    if (error) {
      throw new Error(`Failed to load latest metrics for analysis: ${error.message}`);
    }

    for (const row of Array.isArray(data) ? data : []) {
      if (!row || typeof row !== "object") {
        continue;
      }

      const snapshot = toLatestMetricsSnapshot(row as Record<string, unknown>);
      if (!snapshot || byContent.has(snapshot.content_id)) {
        continue;
      }

      byContent.set(snapshot.content_id, snapshot);
    }
  }

  return byContent;
};

export const loadScoredContentsForAnalysis = async (orgId: string): Promise<AnalysisContentRow[]> => {
  const contents = await loadPublishedContents(orgId);
  if (!contents.length) {
    return [];
  }

  const latestMetricsByContent = await loadLatestMetricsByContent(
    orgId,
    contents.map((row) => row.id)
  );

  return contents
    .map((content) => {
      const snapshot = latestMetricsByContent.get(content.id);
      if (!snapshot || typeof snapshot.performance_score !== "number" || !Number.isFinite(snapshot.performance_score)) {
        return null;
      }

      return {
        ...content,
        metrics: snapshot,
        performance_score: snapshot.performance_score
      } satisfies AnalysisContentRow;
    })
    .filter((row): row is AnalysisContentRow => !!row);
};

export const countScoredContentsForAnalysis = async (orgId: string): Promise<number> => {
  const rows = await loadScoredContentsForAnalysis(orgId);
  return rows.length;
};

export const loadLatestMetricHighWatermark = async (orgId: string): Promise<string | null> => {
  const { data, error } = await supabaseAdmin
    .from("content_metrics")
    .select("collected_at")
    .eq("org_id", orgId)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load metrics high watermark: ${error.message}`);
  }

  return readOptionalString(data?.collected_at ?? null);
};

export const countNewMetricsSince = async (orgId: string, sinceIso: string | null): Promise<number> => {
  let query = supabaseAdmin.from("content_metrics").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  if (sinceIso) {
    query = query.gt("collected_at", sinceIso);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count new metrics since ${sinceIso ?? "origin"}: ${error.message}`);
  }

  return typeof count === "number" ? count : 0;
};

export const loadOrgIdsForAnalysisSweep = async (): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("org_brand_settings").select("org_id").limit(1000);
  if (error) {
    throw new Error(`Failed to load org ids for analysis sweep: ${error.message}`);
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => readOptionalString((row as Record<string, unknown>).org_id))
    .filter((value): value is string => !!value);
};

export const hasQueuedOrRunningAnalysisRun = async (orgId: string): Promise<boolean> => {
  const { data, error } = await supabaseAdmin
    .from("analytics_analysis_runs")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load analysis run state: ${error.message}`);
  }

  return !!data;
};
