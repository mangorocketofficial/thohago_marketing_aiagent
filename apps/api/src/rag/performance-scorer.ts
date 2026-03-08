import {
  ANALYTICS_METRIC_FIELDS,
  DEFAULT_METRIC_REFERENCES,
  computePerformanceScore as computeSharedPerformanceScore,
  computeRobustReference
} from "@repo/analytics";
import type { AnalyticsMetricField, AnalyticsMetricReferences, AnalyticsRawMetrics } from "@repo/analytics";
import type { Channel } from "@repo/types";
import { supabaseAdmin } from "../lib/supabase-admin";

const MIN_STATS_SAMPLE_COUNT = 3;
const MAX_STATS_ROWS = 500;

export type RawMetrics = AnalyticsRawMetrics;

export type OrgChannelStats = {
  channel: Channel;
  sample_count: number;
  references: AnalyticsMetricReferences;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const sanitizeMetricValue = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return value;
};

/**
 * Load per-channel metric baselines from historical snapshots.
 */
export const loadOrgChannelStats = async (orgId: string, channel: Channel): Promise<OrgChannelStats> => {
  const { data, error } = await supabaseAdmin
    .from("content_metrics")
    .select("likes,views,comments,shares,saves,follower_delta")
    .eq("org_id", orgId)
    .eq("channel", channel)
    .order("collected_at", { ascending: false })
    .limit(MAX_STATS_ROWS);

  if (error) {
    throw new Error(`Failed to load content metrics stats: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : [];
  const sampleCount = rows.length;
  if (sampleCount < MIN_STATS_SAMPLE_COUNT) {
    return {
      channel,
      sample_count: sampleCount,
      references: { ...DEFAULT_METRIC_REFERENCES }
    };
  }

  const references: AnalyticsMetricReferences = { ...DEFAULT_METRIC_REFERENCES };
  for (const key of ANALYTICS_METRIC_FIELDS) {
    const values = rows
      .map((row) => sanitizeMetricValue((row as Record<string, unknown>)[key]))
      .filter((value): value is number => value !== null)
      .map((value) => Math.max(0, value));
    references[key] = computeRobustReference(values, DEFAULT_METRIC_REFERENCES[key], MIN_STATS_SAMPLE_COUNT);
  }

  return {
    channel,
    sample_count: sampleCount,
    references
  };
};

/**
 * Compute normalized 0-100 performance score from channel-weighted metrics.
 */
export const computePerformanceScore = (
  metrics: RawMetrics,
  channel: Channel,
  orgStats: OrgChannelStats
): number | null => {
  return computeSharedPerformanceScore(metrics, channel, orgStats.references);
};
