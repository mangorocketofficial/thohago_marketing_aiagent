import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { computePerformanceScore, computeRobustReference, type OrgChannelStats } from "../src/rag/performance-scorer";
import {
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  extractTopCtaPhrases
} from "../src/rag/performance-insight-helpers";
import { parseAccumulatedInsights } from "../src/rag/data";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ContentFixture = {
  id: string;
  channel: string;
  body: string | null;
  published_at: string | null;
  created_at: string;
  latest_metrics: null;
};

type MetricsEntry = {
  content_id: string;
  _channel?: string;
  _note?: string;
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

const loadJson = async <T>(fileName: string): Promise<T> => {
  const raw = await readFile(resolve(__dirname, "fixtures", fileName), "utf-8");
  return JSON.parse(raw) as T;
};

const CHANNELS = ["instagram", "threads", "naver_blog", "facebook", "youtube"] as const;

describe("phase 8-1 fixture structural validation", () => {
  it("wfk-published-contents has 20 items covering all 5 channels", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");

    assert.equal(contents.length, 20);

    const channelCounts: Record<string, number> = {};
    for (const item of contents) {
      channelCounts[item.channel] = (channelCounts[item.channel] ?? 0) + 1;
    }

    for (const ch of CHANNELS) {
      assert.ok((channelCounts[ch] ?? 0) >= 2, `channel ${ch} should have at least 2 contents`);
    }
  });

  it("all content ids are unique UUIDs", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const ids = new Set(contents.map((c) => c.id));
    assert.equal(ids.size, contents.length, "duplicate content ids found");
  });

  it("all contents have published_at in valid ISO format", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    for (const item of contents) {
      assert.ok(item.published_at, `content ${item.id} missing published_at`);
      const date = new Date(item.published_at);
      assert.ok(!Number.isNaN(date.getTime()), `content ${item.id} has invalid published_at`);
    }
  });

  it("metrics batch has matching content_ids for all 20 contents", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");

    assert.equal(batch.entries.length, 20);

    const contentIds = new Set(contents.map((c) => c.id));
    for (const entry of batch.entries) {
      assert.ok(contentIds.has(entry.content_id), `metrics entry ${entry.content_id} not in published contents`);
    }
  });

  it("each metrics entry has at least one numeric value", async () => {
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const metricFields = ["likes", "comments", "shares", "saves", "follower_delta", "views"];

    for (const entry of batch.entries) {
      const hasValue = metricFields.some(
        (field) => typeof (entry as Record<string, unknown>)[field] === "number"
      );
      assert.ok(hasValue, `entry ${entry.content_id} has no metric values`);
    }
  });

  it("naver_blog/youtube entries use views field", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");

    const blogYoutubeIds = new Set(
      contents.filter((c) => c.channel === "naver_blog" || c.channel === "youtube").map((c) => c.id)
    );

    for (const entry of batch.entries) {
      if (blogYoutubeIds.has(entry.content_id)) {
        assert.ok(
          typeof entry.views === "number",
          `blog/youtube entry ${entry.content_id} should have views field`
        );
      }
    }
  });

  it("idempotency key is valid format", async () => {
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    assert.ok(batch.request_idempotency_key);
    assert.ok(/^[A-Za-z0-9:_-]{8,120}$/.test(batch.request_idempotency_key));
  });
});

describe("phase 8-1 scoring integration with fixtures", () => {
  const defaultStats: OrgChannelStats = {
    channel: "instagram",
    sample_count: 0,
    references: { likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20 }
  };

  it("high-performing instagram content scores above 70", async () => {
    const score = computePerformanceScore(
      { likes: 320, comments: 48, shares: 35, saves: 92, follower_delta: 28 },
      "instagram",
      defaultStats
    );
    assert.ok(typeof score === "number");
    assert.ok(score >= 70, `expected >= 70, got ${score}`);
  });

  it("low-performing instagram content scores below 50", async () => {
    const score = computePerformanceScore(
      { likes: 65, comments: 4, shares: 2, saves: 18, follower_delta: -2 },
      "instagram",
      defaultStats
    );
    assert.ok(typeof score === "number");
    assert.ok(score < 50, `expected < 50, got ${score}`);
  });

  it("high-performing naver_blog content scores above 70", async () => {
    const blogStats: OrgChannelStats = {
      channel: "naver_blog",
      sample_count: 0,
      references: { likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20 }
    };
    const score = computePerformanceScore(
      { likes: 3200, comments: 45 },
      "naver_blog",
      blogStats
    );
    assert.ok(typeof score === "number");
    assert.ok(score >= 70, `expected >= 70, got ${score}`);
  });

  it("high-performing youtube content scores above 70", async () => {
    const ytStats: OrgChannelStats = {
      channel: "youtube",
      sample_count: 0,
      references: { likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20 }
    };
    const score = computePerformanceScore(
      { likes: 8500, comments: 65 },
      "youtube",
      ytStats
    );
    assert.ok(typeof score === "number");
    assert.ok(score >= 70, `expected >= 70, got ${score}`);
  });
});

describe("phase 8-1 insight helpers with fixture data", () => {
  it("computeBestPublishTimes picks correct time buckets for Asia/Seoul", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const defaultStats: OrgChannelStats = {
      channel: "instagram",
      sample_count: 0,
      references: { likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20 }
    };

    const rows = contents.map((c) => {
      const entry = batch.entries.find((e) => e.content_id === c.id);
      const metrics = entry
        ? { likes: entry.likes ?? entry.views ?? null, comments: entry.comments ?? null,
            shares: entry.shares ?? null, saves: entry.saves ?? null, follower_delta: entry.follower_delta ?? null }
        : null;
      const score = metrics
        ? computePerformanceScore(metrics, c.channel as "instagram", defaultStats)
        : null;
      return {
        channel: c.channel,
        published_at: c.published_at,
        performance_score: score
      };
    });

    const bestTimes = computeBestPublishTimes(rows, "Asia/Seoul");

    assert.ok(bestTimes.instagram, "instagram should have a best publish time");
    assert.ok(bestTimes.instagram.includes("(Asia/Seoul)"), "should include timezone");

    // Instagram high-performer published at 09:30 UTC = 18:30 KST → bucket 18:00-20:00
    assert.ok(bestTimes.instagram.startsWith("18:00"), `expected 18:00 bucket, got ${bestTimes.instagram}`);
  });

  it("extractTopCtaPhrases finds Korean and English CTAs from high scorers", async () => {
    const contents = await loadJson<ContentFixture[]>("wfk-published-contents.json");
    const batch = await loadJson<MetricsBatchFixture>("wfk-metrics-batch-input.json");
    const defaultStats: OrgChannelStats = {
      channel: "instagram",
      sample_count: 0,
      references: { likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20 }
    };

    const rows = contents.map((c) => {
      const entry = batch.entries.find((e) => e.content_id === c.id);
      const metrics = entry
        ? { likes: entry.likes ?? entry.views ?? null, comments: entry.comments ?? null,
            shares: entry.shares ?? null, saves: entry.saves ?? null, follower_delta: entry.follower_delta ?? null }
        : null;
      const score = metrics
        ? computePerformanceScore(metrics, c.channel as "instagram", defaultStats)
        : null;
      return { body: c.body, performance_score: score };
    });

    const phrases = extractTopCtaPhrases(rows, 5);

    assert.ok(phrases.length >= 2, `expected at least 2 CTA phrases, got ${phrases.length}`);
    assert.ok(phrases.length <= 5, `expected at most 5 CTA phrases, got ${phrases.length}`);

    // High-scoring content (id 001) has "지금 바로 신청" and "프로필 링크"
    const allPhrases = phrases.join(" ");
    const hasKoreanCta = allPhrases.includes("지금") || allPhrases.includes("프로필") || allPhrases.includes("링크");
    assert.ok(hasKoreanCta, `expected Korean CTA phrases, got: ${phrases.join(", ")}`);
  });

  it("wfk-dummy-insights.json still parses with parseAccumulatedInsights", async () => {
    const raw = await loadJson<Record<string, unknown>>("wfk-dummy-insights.json");
    const parsed = parseAccumulatedInsights(raw);
    assert.ok(parsed, "old fixture should still parse");
    assert.equal(parsed.content_count_at_generation, 87);
  });
});
