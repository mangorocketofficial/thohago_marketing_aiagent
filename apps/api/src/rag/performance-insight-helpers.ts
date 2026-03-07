const CTA_SCORE_THRESHOLD = 70;
const BEST_TIME_MIN_SAMPLES = 2;

const clampHour = (value: number): number => Math.max(0, Math.min(23, value));

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
  return Number.isFinite(hour) ? clampHour(hour) : null;
};

const formatBucket = (bucketStart: number, timezone: string): string => {
  const from = `${String(bucketStart).padStart(2, "0")}:00`;
  const to = `${String((bucketStart + 2) % 24).padStart(2, "0")}:00`;
  return `${from}-${to} (${timezone})`;
};

/**
 * Build content pattern summary text from per-channel counts.
 */
export const buildContentPatternSummary = (channelCounts: Record<string, number>): string => {
  const total = Object.values(channelCounts).reduce((sum, count) => sum + count, 0);
  if (!total) {
    return "";
  }

  const pairs = Object.entries(channelCounts)
    .sort((left, right) => right[1] - left[1])
    .map(([channel, count]) => `${channel}: ${count}`);
  return `Total ${total} contents (${pairs.join(", ")})`;
};

/**
 * Compute best 2-hour publish windows by channel using performance scores.
 */
export const computeBestPublishTimes = (
  rows: Array<{ channel: string; published_at: string | null; performance_score: number | null }>,
  timezone: string
): Record<string, string> => {
  const bucketStats = new Map<string, { channel: string; bucketStart: number; count: number; scoreSum: number }>();

  for (const row of rows) {
    if (!row.published_at || typeof row.performance_score !== "number" || !Number.isFinite(row.performance_score)) {
      continue;
    }
    const hour = getHourForTimezone(row.published_at, timezone);
    if (hour === null) {
      continue;
    }
    const bucketStart = Math.floor(hour / 2) * 2;
    const key = `${row.channel}:${bucketStart}`;
    const existing = bucketStats.get(key) ?? { channel: row.channel, bucketStart, count: 0, scoreSum: 0 };
    existing.count += 1;
    existing.scoreSum += row.performance_score;
    bucketStats.set(key, existing);
  }

  const bestByChannel = new Map<string, { bucketStart: number; avgScore: number }>();
  for (const bucket of bucketStats.values()) {
    if (bucket.count < BEST_TIME_MIN_SAMPLES) {
      continue;
    }
    const avgScore = bucket.scoreSum / bucket.count;
    const current = bestByChannel.get(bucket.channel);
    if (!current || avgScore > current.avgScore) {
      bestByChannel.set(bucket.channel, { bucketStart: bucket.bucketStart, avgScore });
    }
  }

  const output: Record<string, string> = {};
  for (const [channel, best] of bestByChannel.entries()) {
    output[channel] = formatBucket(best.bucketStart, timezone);
  }
  return output;
};

/**
 * Extract high-performing CTA phrases from scored content bodies.
 */
export const extractTopCtaPhrases = (
  rows: Array<{ body: string | null; performance_score: number | null }>,
  topN = 5
): string[] => {
  const patterns = [
    /지금\s*(바로)?\s*(클릭|확인|신청|구매|방문|참여)/gi,
    /링크\s*(클릭|확인)/gi,
    /프로필\s*(링크|에서)/gi,
    /\bclick now\b/gi,
    /\blearn more\b/gi,
    /\bshop now\b/gi,
    /\bsign up\b/gi
  ];

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.body || typeof row.performance_score !== "number" || row.performance_score < CTA_SCORE_THRESHOLD) {
      continue;
    }

    const perContent = new Set<string>();
    for (const pattern of patterns) {
      for (const match of row.body.matchAll(pattern)) {
        const phrase = match[0]?.trim().replace(/\s+/g, " ").toLowerCase();
        if (!phrase || perContent.has(phrase)) {
          continue;
        }
        perContent.add(phrase);
      }
    }

    for (const phrase of perContent) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, topN))
    .map(([phrase]) => phrase);
};

/**
 * Build channel recommendations using volume, quality and confidence signals.
 */
export const buildPerformanceAwareRecommendations = (
  channelCounts: Record<string, number>,
  avgScores: Record<string, number>,
  scoreSamples: Record<string, number>
): Record<string, string> => {
  const channels = new Set([...Object.keys(channelCounts), ...Object.keys(avgScores)]);
  const recommendations: Record<string, string> = {};

  for (const channel of channels) {
    const totalCount = channelCounts[channel] ?? 0;
    const avgScore = avgScores[channel];
    const sampleCount = scoreSamples[channel] ?? 0;

    if (!Number.isFinite(avgScore)) {
      recommendations[channel] =
        totalCount >= 3
          ? `${totalCount} published items. Collect more performance metrics to improve quality recommendations.`
          : `${totalCount} published items. Increase publishing frequency to build reliable insights.`;
      continue;
    }

    const confidence = sampleCount >= 10 ? "high-confidence" : "low-confidence";
    if (avgScore >= 70) {
      recommendations[channel] =
        `Strong performance (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
        "Scale this channel while preserving the current format and CTA style.";
      continue;
    }
    if (avgScore >= 45) {
      recommendations[channel] =
        `Moderate performance (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
        "Run controlled experiments on publish time and CTA variants.";
      continue;
    }

    recommendations[channel] =
      `Underperforming (${avgScore.toFixed(1)} avg, ${confidence}, n=${sampleCount}). ` +
      "Review hook quality, audience fit, and CTA clarity before increasing volume.";
  }

  return recommendations;
};

/**
 * Validate timezone id and fallback to UTC.
 */
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
