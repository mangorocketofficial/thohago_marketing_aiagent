import { ANALYTICS_CHANNELS, ANALYTICS_CHANNEL_DISPLAY_ORDER, toOrderedAnalyticsChannels } from "./channels.js";

const CTA_SCORE_THRESHOLD = 70;
const BEST_TIME_MIN_SAMPLES = 2;

type CountEntry = {
  key: string;
  count: number;
};

const CTA_PATTERNS = [
  /지금\s*(바로)?\s*(클릭|확인|신청|구매|방문|참여)/gi,
  /프로필\s*링크/gi,
  /자세히\s*보기/gi,
  /\bclick now\b/gi,
  /\blearn more\b/gi,
  /\bshop now\b/gi,
  /\bsign up\b/gi
] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const getRank = (channel: string): number => {
  const index = ANALYTICS_CHANNELS.indexOf(channel as (typeof ANALYTICS_CHANNELS)[number]);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
};

const getHourForTimezone = (iso: string, timezone: string): number | null => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23"
  }).format(parsed);
  const hour = Number.parseInt(hourText, 10);
  return Number.isFinite(hour) ? clamp(hour, 0, 23) : null;
};

const formatBucket = (bucketStart: number, timezone: string): string => {
  const from = `${String(bucketStart).padStart(2, "0")}:00`;
  const to = `${String((bucketStart + 2) % 24).padStart(2, "0")}:00`;
  return `${from}-${to} (${timezone})`;
};

export const buildContentPatternSummary = (channelCounts: Record<string, number>): string => {
  const total = Object.values(channelCounts).reduce((sum, count) => sum + count, 0);
  if (!total) {
    return "";
  }

  const pairs = Object.entries(channelCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return getRank(left[0]) - getRank(right[0]);
    })
    .map(([channel, count]) => `${channel}: ${count}`);

  return `Total ${total} contents (${pairs.join(", ")})`;
};

export const normalizeTimezone = (value: string | null | undefined): string => {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone) {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
};

export const computeBestPublishTimes = (
  rows: Array<{ channel: string; published_at: string | null; performance_score: number | null }>,
  timezone: string
): Record<string, string> => {
  const bucketStats = new Map<string, { channel: string; bucketStart: number; count: number; scoreSum: number }>();

  for (const row of rows) {
    if (!row.published_at || !isFiniteNumber(row.performance_score)) {
      continue;
    }
    const hour = getHourForTimezone(row.published_at, timezone);
    if (hour === null) {
      continue;
    }

    const bucketStart = Math.floor(hour / 2) * 2;
    const key = `${row.channel}:${bucketStart}`;
    const current = bucketStats.get(key) ?? { channel: row.channel, bucketStart, count: 0, scoreSum: 0 };
    current.count += 1;
    current.scoreSum += row.performance_score;
    bucketStats.set(key, current);
  }

  const bestByChannel = new Map<string, { bucketStart: number; avgScore: number }>();
  for (const bucket of bucketStats.values()) {
    if (bucket.count < BEST_TIME_MIN_SAMPLES) {
      continue;
    }

    const avgScore = bucket.scoreSum / bucket.count;
    const existing = bestByChannel.get(bucket.channel);
    if (!existing || avgScore > existing.avgScore) {
      bestByChannel.set(bucket.channel, { bucketStart: bucket.bucketStart, avgScore });
    }
  }

  return Object.fromEntries(
    [...bestByChannel.entries()].map(([channel, best]) => [channel, formatBucket(best.bucketStart, timezone)])
  );
};

export const extractTopCtaPhrases = (
  rows: Array<{ body: string | null; performance_score: number | null }>,
  topN = 5
): string[] => {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.body || !isFiniteNumber(row.performance_score) || row.performance_score < CTA_SCORE_THRESHOLD) {
      continue;
    }

    const seenInRow = new Set<string>();
    for (const pattern of CTA_PATTERNS) {
      for (const match of row.body.matchAll(pattern)) {
        const phrase = match[0]?.trim().replace(/\s+/g, " ").toLowerCase();
        if (!phrase || seenInRow.has(phrase)) {
          continue;
        }
        seenInRow.add(phrase);
      }
    }

    for (const phrase of seenInRow) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, topN))
    .map(([phrase]) => phrase);
};

export const buildPerformanceAwareRecommendations = (
  channelCounts: Record<string, number>,
  avgScores: Record<string, number>,
  scoreSamples: Record<string, number>
): Record<string, string> => {
  const channels = toOrderedAnalyticsChannels([
    ...Object.keys(channelCounts),
    ...Object.keys(avgScores),
    ...Object.keys(scoreSamples)
  ]);
  const recommendations: Record<string, string> = {};

  for (const channel of channels) {
    const totalCount = channelCounts[channel] ?? 0;
    const avgScore = avgScores[channel];
    const sampleCount = scoreSamples[channel] ?? 0;

    if (!Number.isFinite(avgScore)) {
      recommendations[channel] =
        totalCount >= 3
          ? `${totalCount} published items. Metrics API is connected, but more score samples are needed for reliable recommendations.`
          : `${totalCount} published items. Increase publishing frequency and metrics coverage to build reliable insights.`;
      continue;
    }

    const confidence = sampleCount >= 10 ? "high-confidence" : "low-confidence";
    if (avgScore >= 70) {
      recommendations[channel] =
        `Strong performance (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
        "Preserve the winning hook and CTA structure while scaling volume carefully.";
      continue;
    }
    if (avgScore >= 45) {
      recommendations[channel] =
        `Moderate performance (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
        "Run controlled tests on publish time, opening hook, and CTA clarity.";
      continue;
    }

    recommendations[channel] =
      `Underperforming (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
      "Revisit audience fit, hook strength, and CTA placement before increasing volume.";
  }

  return recommendations;
};

export const extractKeyCountEntries = (summary: string): CountEntry[] => {
  const output = new Map<string, number>();
  for (const match of summary.matchAll(/([a-z_]+)\s*:\s*(\d+)/gi)) {
    const key = match[1]?.trim().toLowerCase();
    const count = Number.parseInt(match[2] ?? "", 10);
    if (!key || Number.isNaN(count)) {
      continue;
    }
    output.set(key, count);
  }

  const orderedKnownEntries: CountEntry[] = ANALYTICS_CHANNEL_DISPLAY_ORDER
    .filter((channel) => output.has(channel))
    .map((channel) => ({ key: channel, count: output.get(channel) ?? 0 }));
  const orderedExtraEntries: CountEntry[] = [...output.entries()]
    .filter(([key]) => !ANALYTICS_CHANNEL_DISPLAY_ORDER.includes(key as (typeof ANALYTICS_CHANNEL_DISPLAY_ORDER)[number]))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));

  return [...orderedKnownEntries, ...orderedExtraEntries];
};
