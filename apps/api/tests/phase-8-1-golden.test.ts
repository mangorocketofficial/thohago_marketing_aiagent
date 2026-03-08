import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  extractTopCtaPhrases
} from "@repo/analytics";
import { HttpError } from "../src/lib/errors";
import { computePerformanceScore, type OrgChannelStats } from "../src/rag/performance-scorer";
import {
  encodeMetricsCursor,
  parseMetricsCursor,
  parseMetricsEntries,
  parseRequestIdempotencyKey,
  toCanonicalMetrics
} from "../src/routes/metrics-helpers";

type GoldenMeta = {
  scenario: string;
  description: string;
  is_deterministic: "yes" | "no" | "uncertain";
  created_at: string;
  approved_by: string;
  version: string;
};

type MetricsParseAndScoreGolden = GoldenMeta & {
  input: {
    channel: "instagram";
    org_stats: OrgChannelStats;
    entries: Array<Record<string, unknown>>;
    cursor: {
      created_at: string;
      id: string;
    };
  };
  output: {
    parsed_entries: Array<Record<string, unknown>>;
    canonical_metrics: Record<string, number | null>;
    performance_score: number | null;
    encoded_cursor: string;
    decoded_cursor: {
      created_at: string;
      id: string;
    };
  };
};

type PerformanceInsightsGolden = GoldenMeta & {
  input: {
    timezone: string;
    rows: Array<{ channel: string; published_at: string | null; performance_score: number | null }>;
    cta_rows: Array<{ body: string | null; performance_score: number | null }>;
    channel_counts: Record<string, number>;
    avg_scores: Record<string, number>;
    score_samples: Record<string, number>;
  };
  output: {
    best_publish_times: Record<string, string>;
    cta_phrases: string[];
    recommendations: Record<string, string>;
  };
};

type InvalidIdempotencyKeyGolden = GoldenMeta & {
  input: {
    body: Record<string, unknown>;
  };
  output_error: {
    status: number;
    code: string;
    message: string;
  };
};

const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

describe("Phase 8-1 golden snapshots", () => {
  it("matches metrics parse + canonical score + cursor roundtrip golden", () => {
    const golden = loadGolden<MetricsParseAndScoreGolden>(
      "phase8-1-happy-metrics-parse-score-cursor-20260307-v1.golden.json"
    );
    const parsedEntries = parseMetricsEntries(golden.input.entries);
    const canonicalMetrics = toCanonicalMetrics(golden.input.channel, parsedEntries[0]!);
    const performanceScore = computePerformanceScore(canonicalMetrics, golden.input.channel, golden.input.org_stats);
    const encodedCursor = encodeMetricsCursor(golden.input.cursor);
    const decodedCursor = parseMetricsCursor(encodedCursor);

    assert.deepEqual(parsedEntries, golden.output.parsed_entries);
    assert.deepEqual(canonicalMetrics, golden.output.canonical_metrics);
    assert.equal(performanceScore, golden.output.performance_score);
    assert.equal(encodedCursor, golden.output.encoded_cursor);
    assert.deepEqual(decodedCursor, golden.output.decoded_cursor);
  });

  it("matches performance insight helper outputs golden", () => {
    const golden = loadGolden<PerformanceInsightsGolden>("phase8-1-happy-performance-insight-helpers-20260307-v1.golden.json");
    const bestPublishTimes = computeBestPublishTimes(golden.input.rows, golden.input.timezone);
    const ctaPhrases = extractTopCtaPhrases(golden.input.cta_rows, 5);
    const recommendations = buildPerformanceAwareRecommendations(
      golden.input.channel_counts,
      golden.input.avg_scores,
      golden.input.score_samples
    );

    assert.deepEqual(bestPublishTimes, golden.output.best_publish_times);
    assert.deepEqual(ctaPhrases, golden.output.cta_phrases);
    assert.deepEqual(recommendations, golden.output.recommendations);
  });

  it("matches request idempotency key validation error golden", () => {
    const golden = loadGolden<InvalidIdempotencyKeyGolden>(
      "phase8-1-error-request-idempotency-key-invalid-20260307-v1.golden.json"
    );

    assert.throws(
      () => parseRequestIdempotencyKey(golden.input.body),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        if (!(error instanceof HttpError)) {
          return false;
        }
        assert.equal(error.status, golden.output_error.status);
        assert.equal(error.code, golden.output_error.code);
        assert.equal(error.message, golden.output_error.message);
        return true;
      }
    );
  });
});
