import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANALYTICS_CHANNELS,
  DEFAULT_METRIC_REFERENCES,
  buildContentPatternSummary,
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  computePerformanceScore,
  extractTopCtaPhrases,
  normalizeMetricsForStorage,
  parseAccumulatedInsights
} from "@repo/analytics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ContentFixture = {
  id: string;
  channel: (typeof ANALYTICS_CHANNELS)[number];
  body: string | null;
  published_at: string | null;
  created_at: string;
  latest_metrics: null;
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
  description: string;
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

const loadJson = async <T>(fileName: string): Promise<T> => {
  const raw = await readFile(resolve(__dirname, "fixtures", fileName), "utf-8");
  return JSON.parse(raw) as T;
};

const parseAvg = (recommendation: string): number | null => {
  const matched = recommendation.match(/([0-9]+(?:\.[0-9]+)?)\s*avg/i);
  return matched ? Number.parseFloat(matched[1] ?? "") : null;
};

const buildScoredRows = (contents: ContentFixture[], batch: MetricsBatchFixture) => {
  const entriesByContentId = new Map(batch.entries.map((entry) => [entry.content_id, entry]));
  return contents.map((content) => {
    const entry = entriesByContentId.get(content.id);
    const score = entry
      ? computePerformanceScore(
          normalizeMetricsForStorage(content.channel, entry),
          content.channel,
          DEFAULT_METRIC_REFERENCES
        )
      : null;

    return {
      id: content.id,
      channel: content.channel,
      body: content.body,
      published_at: content.published_at,
      performance_score: score
    };
  });
};

describe("phase 8-1 fixture structural validation", () => {
  it("wfk-published-contents has 20 items covering all analytics channels", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");

    assert.equal(contents.length, 20);

    const channelCounts: Record<string, number> = {};
    for (const item of contents) {
      channelCounts[item.channel] = (channelCounts[item.channel] ?? 0) + 1;
    }

    for (const channel of ANALYTICS_CHANNELS) {
      assert.ok((channelCounts[channel] ?? 0) >= 2, `channel ${channel} should have at least 2 contents`);
    }
  });

  it("all content ids are unique", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const ids = new Set(contents.map((content) => content.id));
    assert.equal(ids.size, contents.length, "duplicate content ids found");
  });

  it("all contents have valid published_at values", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    for (const item of contents) {
      assert.ok(item.published_at, `content ${item.id} missing published_at`);
      assert.ok(!Number.isNaN(new Date(item.published_at).getTime()), `content ${item.id} has invalid published_at`);
    }
  });

  it("metrics batch covers all 20 published contents", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");

    assert.equal(batch.entries.length, 20);
    const contentIds = new Set(contents.map((content) => content.id));
    for (const entry of batch.entries) {
      assert.ok(contentIds.has(entry.content_id), `metrics entry ${entry.content_id} not in published contents`);
    }
  });

  it("requires views for naver_blog and youtube entries", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const channelByContentId = new Map(contents.map((content) => [content.id, content.channel]));

    for (const entry of batch.entries) {
      const channel = channelByContentId.get(entry.content_id);
      if (channel === "naver_blog" || channel === "youtube") {
        assert.equal(typeof entry.views, "number", `expected views for ${entry.content_id}`);
      }
    }
  });
});

describe("phase 8-1 scoring integration with fixtures", () => {
  it("scores representative fixture rows into expected bands", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const scoredRows = buildScoredRows(contents, batch);

    const highInstagram = scoredRows.find((row) => row.id.endsWith("0001"))?.performance_score;
    const lowInstagram = scoredRows.find((row) => row.id.endsWith("0004"))?.performance_score;
    const highBlog = scoredRows.find((row) => row.id.endsWith("0011"))?.performance_score;
    const highYoutube = scoredRows.find((row) => row.id.endsWith("0021"))?.performance_score;

    assert.ok(typeof highInstagram === "number" && highInstagram >= 70, `expected instagram >= 70, got ${highInstagram}`);
    assert.ok(typeof lowInstagram === "number" && lowInstagram < 50, `expected instagram < 50, got ${lowInstagram}`);
    assert.ok(typeof highBlog === "number" && highBlog >= 70, `expected blog >= 70, got ${highBlog}`);
    assert.ok(typeof highYoutube === "number" && highYoutube >= 80, `expected youtube >= 80, got ${highYoutube}`);
  });
});

describe("phase 8-1 insight helpers with fixture data", () => {
  it("derives publish times, CTAs, and recommendations from fixture rows", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const expected = await loadJson<ExpectedInsightsFixture>("wfk-expected-insights.json");
    const scoredRows = buildScoredRows(contents, batch);

    const channelCounts = contents.reduce<Record<string, number>>((acc, content) => {
      acc[content.channel] = (acc[content.channel] ?? 0) + 1;
      return acc;
    }, {});

    const scoreSumByChannel: Record<string, number> = {};
    const scoreCountByChannel: Record<string, number> = {};
    for (const row of scoredRows) {
      if (typeof row.performance_score !== "number") {
        continue;
      }
      scoreSumByChannel[row.channel] = (scoreSumByChannel[row.channel] ?? 0) + row.performance_score;
      scoreCountByChannel[row.channel] = (scoreCountByChannel[row.channel] ?? 0) + 1;
    }
    const avgScores = Object.fromEntries(
      Object.entries(scoreSumByChannel).map(([channel, sum]) => [channel, sum / (scoreCountByChannel[channel] ?? 1)])
    );

    const bestTimes = computeBestPublishTimes(scoredRows, "Asia/Seoul");
    const phrases = extractTopCtaPhrases(scoredRows, 5);
    const recommendations = buildPerformanceAwareRecommendations(channelCounts, avgScores, scoreCountByChannel);

    assert.deepEqual(bestTimes, expected.best_publish_times);
    assert.equal(phrases.length >= expected.top_cta_phrases.min_count, true);
    assert.equal(phrases.length <= expected.top_cta_phrases.max_count, true);

    const matchedPhraseCount = expected.top_cta_phrases.expected_phrases.filter((phrase) =>
      phrases.some((actual) => actual.includes(phrase.toLowerCase()) || phrase.toLowerCase().includes(actual))
    ).length;
    assert.ok(matchedPhraseCount >= 3, `expected at least 3 CTA phrase matches, got ${phrases.join(", ")}`);

    const contentPattern = buildContentPatternSummary(channelCounts);
    assert.equal(contentPattern, expected.content_pattern_summary.expected_pattern);

    for (const [channel, rule] of Object.entries(expected.channel_recommendations)) {
      const actual = recommendations[channel];
      const avg = parseAvg(actual ?? "");
      assert.ok(actual?.includes(rule.expected_contains), `missing phrase for ${channel}: ${actual}`);
      assert.ok(typeof avg === "number" && avg >= rule.score_range[0] && avg <= rule.score_range[1], `${channel} avg out of range: ${avg}`);
    }
  });

  it("wfk-dummy-insights fixture still parses as accumulated insights", async () => {
    const raw = await loadJson<Record<string, unknown>>("wfk-dummy-insights.json");
    const parsed = parseAccumulatedInsights(raw);

    assert.ok(parsed, "fixture should parse");
    assert.equal(parsed.content_count_at_generation, 87);
    assert.ok(parsed.content_pattern_summary.startsWith("총 87개 콘텐츠"));
  });
});
