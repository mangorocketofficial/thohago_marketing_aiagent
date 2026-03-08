import {
  ANALYTICS_CHANNELS,
  DEFAULT_METRIC_REFERENCES,
  buildContentPatternSummary,
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  computePerformanceScore,
  extractTopCtaPhrases,
  normalizeMetricsForStorage
} from "@repo/analytics";
import type { Channel } from "@repo/types";

type PublishedFixtureRow = {
  id: string;
  channel: Channel;
  body: string | null;
  published_at: string | null;
};

type MetricsEntry = {
  content_id: string;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  follower_delta?: number;
  views?: number;
};

type MetricsBatchFixture = {
  request_idempotency_key: string;
  entries: MetricsEntry[];
};

type ExpectedInsightsFixture = {
  best_publish_times: Record<string, string>;
  top_cta_phrases: {
    expected_phrases: string[];
    min_count: number;
    max_count: number;
  };
  content_pattern_summary: {
    expected_pattern: string;
  };
  channel_recommendations: Record<
    string,
    {
      expected_contains: string;
      score_range: [number, number];
    }
  >;
};

type FixturesPayload = {
  published_contents: unknown;
  metrics_batch_input: unknown;
  expected_insights: unknown;
  validation_test_source: string;
};

export type FixtureValidationCheck = {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
};

export type FixtureValidationReport = {
  checks: FixtureValidationCheck[];
  scoredRows: Array<{ id: string; channel: Channel; body: string | null; published_at: string | null; performance_score: number | null }>;
  derived: {
    best_publish_times: Record<string, string>;
    top_cta_phrases: string[];
    channel_recommendations: Record<string, string>;
    content_pattern_summary: string;
  };
  fixturesMeta: {
    publishedCount: number;
    metricsCount: number;
    validationSpecLineCount: number;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const parseChannel = (value: unknown): Channel | null => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ANALYTICS_CHANNELS.includes(normalized as Channel) ? (normalized as Channel) : null;
};

const parsePublishedRows = (value: unknown): PublishedFixtureRow[] =>
  Array.isArray(value)
    ? value
        .map((row) => {
          if (!isRecord(row)) {
            return null;
          }
          const channel = parseChannel(row.channel);
          const id = typeof row.id === "string" ? row.id.trim() : "";
          if (!channel || !id) {
            return null;
          }
          return {
            id,
            channel,
            body: typeof row.body === "string" ? row.body : null,
            published_at: typeof row.published_at === "string" ? row.published_at : null
          } satisfies PublishedFixtureRow;
        })
        .filter((row): row is PublishedFixtureRow => !!row)
    : [];

const parseMetricsBatch = (value: unknown): MetricsBatchFixture => {
  if (!isRecord(value)) {
    return { request_idempotency_key: "", entries: [] };
  }
  return {
    request_idempotency_key:
      typeof value.request_idempotency_key === "string" ? value.request_idempotency_key.trim() : "",
    entries: Array.isArray(value.entries)
      ? value.entries
          .map((row) => (isRecord(row) ? (row as MetricsEntry) : null))
          .filter((row): row is MetricsEntry => !!row && typeof row.content_id === "string")
      : []
  };
};

const parseExpectedInsights = (value: unknown): ExpectedInsightsFixture => {
  if (!isRecord(value)) {
    return {
      best_publish_times: {},
      top_cta_phrases: { expected_phrases: [], min_count: 2, max_count: 5 },
      content_pattern_summary: { expected_pattern: "" },
      channel_recommendations: {}
    };
  }

  const topCta = isRecord(value.top_cta_phrases) ? value.top_cta_phrases : {};
  return {
    best_publish_times: isRecord(value.best_publish_times)
      ? Object.fromEntries(
          Object.entries(value.best_publish_times)
            .filter(([, entry]) => typeof entry === "string")
            .map(([key, entry]) => [key, entry as string])
        )
      : {},
    top_cta_phrases: {
      expected_phrases: Array.isArray(topCta.expected_phrases)
        ? topCta.expected_phrases.filter((entry): entry is string => typeof entry === "string")
        : [],
      min_count: isFiniteNumber(topCta.min_count) ? Math.max(1, Math.floor(topCta.min_count)) : 2,
      max_count: isFiniteNumber(topCta.max_count) ? Math.max(1, Math.floor(topCta.max_count)) : 5
    },
    content_pattern_summary: {
      expected_pattern:
        isRecord(value.content_pattern_summary) && typeof value.content_pattern_summary.expected_pattern === "string"
          ? value.content_pattern_summary.expected_pattern
          : ""
    },
    channel_recommendations: isRecord(value.channel_recommendations)
      ? Object.fromEntries(
          Object.entries(value.channel_recommendations)
            .filter(([, row]) => isRecord(row))
            .map(([key, row]) => [key, row as ExpectedInsightsFixture["channel_recommendations"][string]])
        )
      : {}
  };
};

const parseAvg = (recommendation: string): number | null => {
  const matched = recommendation.match(/([0-9]+(?:\.[0-9]+)?)\s*avg/i);
  return matched ? Number.parseFloat(matched[1] ?? "") : null;
};

const pushCheck = (checks: FixtureValidationCheck[], id: string, title: string, passed: boolean, detail: string): void => {
  checks.push({ id, title, passed, detail });
};

export const runWfkFixtureValidation = (payload: FixturesPayload): FixtureValidationReport => {
  const publishedRows = parsePublishedRows(payload.published_contents);
  const metricsBatch = parseMetricsBatch(payload.metrics_batch_input);
  const expected = parseExpectedInsights(payload.expected_insights);
  const entriesByContentId = new Map(metricsBatch.entries.map((entry) => [entry.content_id, entry]));

  const scoredRows = publishedRows.map((row) => {
    const entry = entriesByContentId.get(row.id);
    const score = entry
      ? computePerformanceScore(normalizeMetricsForStorage(row.channel, entry), row.channel, DEFAULT_METRIC_REFERENCES)
      : null;
    return { id: row.id, channel: row.channel, body: row.body, published_at: row.published_at, performance_score: score };
  });

  const channelCounts = publishedRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.channel] = (acc[row.channel] ?? 0) + 1;
    return acc;
  }, {});

  const scoreSumByChannel: Record<string, number> = {};
  const scoreCountByChannel: Record<string, number> = {};
  for (const row of scoredRows) {
    if (!isFiniteNumber(row.performance_score)) {
      continue;
    }
    scoreSumByChannel[row.channel] = (scoreSumByChannel[row.channel] ?? 0) + row.performance_score;
    scoreCountByChannel[row.channel] = (scoreCountByChannel[row.channel] ?? 0) + 1;
  }
  const avgScores = Object.fromEntries(
    Object.entries(scoreSumByChannel).map(([channel, sum]) => [channel, sum / Math.max(1, scoreCountByChannel[channel] ?? 1)])
  );

  const derived = {
    best_publish_times: computeBestPublishTimes(scoredRows, "Asia/Seoul"),
    top_cta_phrases: extractTopCtaPhrases(scoredRows, 5),
    channel_recommendations: buildPerformanceAwareRecommendations(channelCounts, avgScores, scoreCountByChannel),
    content_pattern_summary: buildContentPatternSummary(channelCounts)
  };

  const checks: FixtureValidationCheck[] = [];
  pushCheck(checks, "c1", "published contents size + channel coverage", publishedRows.length === 20 && ANALYTICS_CHANNELS.every((ch) => (channelCounts[ch] ?? 0) >= 2), `rows=${publishedRows.length}, channels=${JSON.stringify(channelCounts)}`);
  pushCheck(checks, "c2", "published content ids are unique", new Set(publishedRows.map((row) => row.id)).size === publishedRows.length, `unique=${new Set(publishedRows.map((row) => row.id)).size}`);
  pushCheck(checks, "c3", "published_at values are valid ISO datetime", publishedRows.every((row) => !!row.published_at && !Number.isNaN(new Date(row.published_at).getTime())), "all rows include valid published_at");
  pushCheck(checks, "c4", "metrics batch maps to all published contents", metricsBatch.entries.length === 20 && metricsBatch.entries.every((entry) => entriesByContentId.has(entry.content_id)), `metrics=${metricsBatch.entries.length}`);
  pushCheck(checks, "c5", "each metrics entry has at least one numeric value", metricsBatch.entries.every((entry) => ["likes", "comments", "shares", "saves", "follower_delta", "views"].some((key) => isFiniteNumber((entry as Record<string, unknown>)[key]))), "all entries include at least one metric");
  pushCheck(checks, "c6", "naver_blog/youtube entries include views", metricsBatch.entries.filter((entry) => {
    const content = publishedRows.find((row) => row.id === entry.content_id);
    return content?.channel === "naver_blog" || content?.channel === "youtube";
  }).every((entry) => isFiniteNumber(entry.views)), "blog/youtube entries include views");
  pushCheck(checks, "c7", "request idempotency key format is valid", /^[A-Za-z0-9:_-]{8,120}$/.test(metricsBatch.request_idempotency_key), metricsBatch.request_idempotency_key || "missing key");

  const score001 = scoredRows.find((row) => row.id.endsWith("0001"))?.performance_score;
  const score004 = scoredRows.find((row) => row.id.endsWith("0004"))?.performance_score;
  const score011 = scoredRows.find((row) => row.id.endsWith("0011"))?.performance_score;
  const score021 = scoredRows.find((row) => row.id.endsWith("0021"))?.performance_score;
  pushCheck(checks, "c8", "high-performing instagram score >= 70", isFiniteNumber(score001) && score001 >= 70, `score=${score001 ?? "null"}`);
  pushCheck(checks, "c9", "low-performing instagram score < 50", isFiniteNumber(score004) && score004 < 50, `score=${score004 ?? "null"}`);
  pushCheck(checks, "c10", "high-performing naver_blog score >= 70", isFiniteNumber(score011) && score011 >= 70, `score=${score011 ?? "null"}`);
  pushCheck(checks, "c11", "high-performing youtube score >= 70", isFiniteNumber(score021) && score021 >= 70, `score=${score021 ?? "null"}`);

  const expectedInstagramBest = expected.best_publish_times.instagram;
  const actualInstagramBest = derived.best_publish_times.instagram ?? "";
  pushCheck(checks, "c12", "best publish time matches expected instagram window", !!actualInstagramBest && actualInstagramBest.includes("(Asia/Seoul)") && (!expectedInstagramBest || actualInstagramBest.startsWith(expectedInstagramBest.slice(0, 5))), `expected=${expectedInstagramBest ?? "-"}, actual=${actualInstagramBest || "-"}`);

  const hasExpectedCta = expected.top_cta_phrases.expected_phrases.some((phrase) =>
    derived.top_cta_phrases.some((actual) => actual.includes(phrase.toLowerCase()) || phrase.toLowerCase().includes(actual))
  );
  pushCheck(checks, "c13", "CTA phrase count/range validation", derived.top_cta_phrases.length >= expected.top_cta_phrases.min_count && derived.top_cta_phrases.length <= expected.top_cta_phrases.max_count && hasExpectedCta, `cta=${derived.top_cta_phrases.join(", ")}`);

  const expectedRecommendationEntries = Object.entries(expected.channel_recommendations).filter(
    ([, row]) => !!row.expected_contains
  );
  const channelsPresent = expectedRecommendationEntries.every(([channel]) => !!derived.channel_recommendations[channel]);
  const parsedAvgCount = expectedRecommendationEntries.filter(([channel]) => {
    const avg = parseAvg(derived.channel_recommendations[channel] ?? "");
    return isFiniteNumber(avg);
  }).length;
  const strictMatchCount = expectedRecommendationEntries.filter(([channel, row]) => {
    const actual = derived.channel_recommendations[channel] ?? "";
    const avg = parseAvg(actual);
    const hasPhrase = actual.toLowerCase().includes(row.expected_contains.toLowerCase());
    const inRange = isFiniteNumber(avg) && avg >= row.score_range[0] && avg <= row.score_range[1];
    return hasPhrase && inRange;
  }).length;
  const patternMatches = !expected.content_pattern_summary.expected_pattern || derived.content_pattern_summary === expected.content_pattern_summary.expected_pattern;
  const recommendationChecks =
    channelsPresent &&
    parsedAvgCount === expectedRecommendationEntries.length &&
    strictMatchCount >= Math.min(2, expectedRecommendationEntries.length);
  pushCheck(
    checks,
    "c14",
    "expected recommendation range + content pattern",
    recommendationChecks && patternMatches,
    `pattern=${derived.content_pattern_summary}; strictMatches=${strictMatchCount}/${expectedRecommendationEntries.length}`
  );

  return {
    checks,
    scoredRows: scoredRows.map((row) => ({ id: row.id, channel: row.channel, body: row.body, published_at: row.published_at, performance_score: row.performance_score })),
    derived,
    fixturesMeta: {
      publishedCount: publishedRows.length,
      metricsCount: metricsBatch.entries.length,
      validationSpecLineCount: payload.validation_test_source.split(/\r?\n/).length
    }
  };
};
