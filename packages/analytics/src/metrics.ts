import type { Channel, ContentMetricsInput } from "@repo/types";

export type AnalyticsMetricField = "likes" | "views" | "comments" | "shares" | "saves" | "follower_delta";

export type AnalyticsMetricReferences = Record<AnalyticsMetricField, number>;

export type AnalyticsRawMetrics = Partial<Record<AnalyticsMetricField, number | null>>;

export const ANALYTICS_METRIC_FIELDS = [
  "likes",
  "views",
  "comments",
  "shares",
  "saves",
  "follower_delta"
] as const satisfies readonly AnalyticsMetricField[];

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const getMetricFieldsForChannel = (channel: Channel): AnalyticsMetricField[] => {
  if (channel === "instagram") {
    return ["likes", "comments", "shares", "saves", "follower_delta"];
  }
  if (channel === "threads") {
    return ["likes", "comments", "shares", "follower_delta"];
  }
  if (channel === "facebook") {
    return ["likes", "comments", "shares"];
  }
  if (channel === "naver_blog") {
    return ["views", "comments"];
  }
  if (channel === "youtube") {
    return ["views", "likes", "comments"];
  }
  return ["likes", "comments"];
};

export const readMetricValue = (
  metrics: AnalyticsRawMetrics | null,
  field: AnalyticsMetricField
): number | null => {
  if (!metrics) {
    return null;
  }
  const value = metrics[field];
  return isFiniteNumber(value) ? value : null;
};

export const normalizeMetricsForStorage = (
  channel: Channel,
  metrics: ContentMetricsInput
): Record<AnalyticsMetricField, number | null> => {
  if (channel === "naver_blog") {
    return {
      likes: null,
      views: isFiniteNumber(metrics.views) ? metrics.views : null,
      comments: isFiniteNumber(metrics.comments) ? metrics.comments : null,
      shares: null,
      saves: null,
      follower_delta: null
    };
  }

  if (channel === "youtube") {
    return {
      likes: isFiniteNumber(metrics.likes) ? metrics.likes : null,
      views: isFiniteNumber(metrics.views) ? metrics.views : null,
      comments: isFiniteNumber(metrics.comments) ? metrics.comments : null,
      shares: null,
      saves: null,
      follower_delta: null
    };
  }

  if (channel === "facebook") {
    return {
      likes: isFiniteNumber(metrics.likes) ? metrics.likes : null,
      views: null,
      comments: isFiniteNumber(metrics.comments) ? metrics.comments : null,
      shares: isFiniteNumber(metrics.shares) ? metrics.shares : null,
      saves: null,
      follower_delta: null
    };
  }

  if (channel === "threads") {
    return {
      likes: isFiniteNumber(metrics.likes) ? metrics.likes : null,
      views: null,
      comments: isFiniteNumber(metrics.comments) ? metrics.comments : null,
      shares: isFiniteNumber(metrics.shares) ? metrics.shares : null,
      saves: null,
      follower_delta: isFiniteNumber(metrics.follower_delta) ? metrics.follower_delta : null
    };
  }

  return {
    likes: isFiniteNumber(metrics.likes) ? metrics.likes : null,
    views: null,
    comments: isFiniteNumber(metrics.comments) ? metrics.comments : null,
    shares: isFiniteNumber(metrics.shares) ? metrics.shares : null,
    saves: isFiniteNumber(metrics.saves) ? metrics.saves : null,
    follower_delta: isFiniteNumber(metrics.follower_delta) ? metrics.follower_delta : null
  };
};

export const normalizeMetricsForScoring = (channel: Channel, metrics: AnalyticsRawMetrics): AnalyticsRawMetrics =>
  normalizeMetricsForStorage(channel, metrics as ContentMetricsInput);
