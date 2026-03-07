import type { Channel } from "@repo/types";
import { supabaseAdmin } from "../lib/supabase-admin";

const METRIC_KEYS = ["likes", "comments", "shares", "saves", "follower_delta"] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const DEFAULT_REFERENCES: Record<MetricKey, number> = {
  likes: 50,
  comments: 10,
  shares: 5,
  saves: 15,
  follower_delta: 20
};

const CHANNEL_METRIC_WEIGHTS: Record<Channel, Partial<Record<MetricKey, number>>> = {
  instagram: {
    likes: 1.0,
    comments: 1.5,
    shares: 1.0,
    saves: 2.0,
    follower_delta: 1.0
  },
  threads: {
    likes: 1.0,
    comments: 1.5,
    shares: 1.0,
    follower_delta: 1.0
  },
  facebook: {
    likes: 1.0,
    comments: 1.5,
    shares: 1.5
  },
  naver_blog: {
    likes: 1.0,
    comments: 2.0
  },
  youtube: {
    likes: 1.0,
    comments: 1.5
  }
};

const MIN_STATS_SAMPLE_COUNT = 3;
const MAX_STATS_ROWS = 500;

export type RawMetrics = Partial<Record<MetricKey, number | null>>;

export type OrgChannelStats = {
  channel: Channel;
  sample_count: number;
  references: Record<MetricKey, number>;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const sanitizeMetricValue = (value: unknown): number | null => {
  if (!isFiniteNumber(value)) {
    return null;
  }
  return value;
};

/**
 * Compute a winsorized reference baseline to reduce outlier sensitivity.
 */
export const computeRobustReference = (
  values: number[],
  fallback: number,
  minSampleCount = MIN_STATS_SAMPLE_COUNT
): number => {
  if (values.length < minSampleCount) {
    return fallback;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const lower = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? sorted[0] ?? fallback;
  const upper = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? sorted[sorted.length - 1] ?? fallback;
  const winsorized = sorted.map((value) => clamp(value, lower, upper));
  const mean = winsorized.reduce((sum, value) => sum + value, 0) / winsorized.length;
  return Math.max(1, mean);
};

/**
 * Load per-channel metric baselines from historical snapshots.
 */
export const loadOrgChannelStats = async (orgId: string, channel: Channel): Promise<OrgChannelStats> => {
  const { data, error } = await supabaseAdmin
    .from("content_metrics")
    .select("likes,comments,shares,saves,follower_delta")
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
      references: { ...DEFAULT_REFERENCES }
    };
  }

  const references: Record<MetricKey, number> = { ...DEFAULT_REFERENCES };
  for (const key of METRIC_KEYS) {
    const values = rows
      .map((row) => sanitizeMetricValue((row as Record<string, unknown>)[key]))
      .filter((value): value is number => value !== null)
      .map((value) => Math.max(0, value));
    references[key] = computeRobustReference(values, DEFAULT_REFERENCES[key]);
  }

  return {
    channel,
    sample_count: sampleCount,
    references
  };
};

const normalizeMetricScore = (value: number, reference: number): number => {
  const safeValue = Math.max(0, value);
  const safeReference = Math.max(1, reference);
  const ratio = safeValue / safeReference;
  // 1x baseline ~= 50, 3x baseline ~= 100. High outliers are softly capped.
  const scaled = Math.log1p(ratio) / Math.log1p(3);
  return clamp(scaled, 0, 1.25);
};

const resolveWeights = (channel: Channel): Partial<Record<MetricKey, number>> =>
  CHANNEL_METRIC_WEIGHTS[channel] ?? CHANNEL_METRIC_WEIGHTS.instagram;

/**
 * Compute normalized 0-100 performance score from channel-weighted metrics.
 */
export const computePerformanceScore = (
  metrics: RawMetrics,
  channel: Channel,
  orgStats: OrgChannelStats
): number | null => {
  const weights = resolveWeights(channel);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of METRIC_KEYS) {
    const rawValue = metrics[key];
    const numericValue = isFiniteNumber(rawValue) ? rawValue : null;
    const weight = weights[key] ?? 0;
    if (numericValue === null || weight <= 0) {
      continue;
    }

    const normalized = normalizeMetricScore(numericValue, orgStats.references[key]);
    weightedSum += normalized * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  const score = (weightedSum / totalWeight) * 100;
  return Math.round(clamp(score, 0, 100) * 100) / 100;
};

