import type { Channel } from "@repo/types";
import {
  ANALYTICS_METRIC_FIELDS,
  type AnalyticsMetricField,
  type AnalyticsMetricReferences,
  type AnalyticsRawMetrics,
  normalizeMetricsForScoring
} from "./metrics.js";

export const DEFAULT_METRIC_REFERENCES: AnalyticsMetricReferences = {
  likes: 50,
  views: 1000,
  comments: 10,
  shares: 5,
  saves: 15,
  follower_delta: 20
};

const CHANNEL_METRIC_WEIGHTS: Record<Channel, Partial<Record<AnalyticsMetricField, number>>> = {
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
    views: 1.0,
    comments: 2.0
  },
  youtube: {
    views: 1.0,
    likes: 0.75,
    comments: 1.5
  }
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const computeRobustReference = (values: number[], fallback: number, minSampleCount = 3): number => {
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

const normalizeMetricScore = (value: number, reference: number): number => {
  const safeValue = Math.max(0, value);
  const safeReference = Math.max(1, reference);
  const ratio = safeValue / safeReference;
  const scaled = Math.log1p(ratio) / Math.log1p(3);
  return clamp(scaled, 0, 1.25);
};

export const computePerformanceScore = (
  metrics: AnalyticsRawMetrics,
  channel: Channel,
  references: AnalyticsMetricReferences
): number | null => {
  const normalizedMetrics = normalizeMetricsForScoring(channel, metrics);
  const weights = CHANNEL_METRIC_WEIGHTS[channel];

  let weightedSum = 0;
  let totalWeight = 0;

  for (const field of ANALYTICS_METRIC_FIELDS) {
    const value = normalizedMetrics[field];
    const weight = weights[field] ?? 0;
    if (!isFiniteNumber(value) || weight <= 0) {
      continue;
    }

    weightedSum += normalizeMetricScore(value, references[field]) * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return Math.round(clamp((weightedSum / totalWeight) * 100, 0, 100) * 100) / 100;
};
