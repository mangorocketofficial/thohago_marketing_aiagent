import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_METRIC_REFERENCES, computeRobustReference } from "@repo/analytics";
import type { OrgChannelStats } from "../src/rag/performance-scorer";
import { computePerformanceScore } from "../src/rag/performance-scorer";

const buildStats = (channel: OrgChannelStats["channel"]): OrgChannelStats => ({
  channel,
  sample_count: 12,
  references: {
    ...DEFAULT_METRIC_REFERENCES,
    likes: 100,
    views: 1000,
    comments: 20,
    shares: 10,
    saves: 30,
    follower_delta: 15
  }
});

describe("performance-scorer", () => {
  it("returns null when no metrics are present", () => {
    const score = computePerformanceScore(
      {
        likes: null,
        views: null,
        comments: null,
        shares: null,
        saves: null,
        follower_delta: null
      },
      "instagram",
      buildStats("instagram")
    );
    assert.equal(score, null);
  });

  it("scores baseline instagram performance near 50", () => {
    const score = computePerformanceScore(
      {
        likes: 100,
        comments: 20,
        shares: 10,
        saves: 30,
        follower_delta: 15
      },
      "instagram",
      buildStats("instagram")
    );

    assert.ok(typeof score === "number");
    assert.ok(score >= 49 && score <= 51);
  });

  it("scores strong instagram outperformance close to 100", () => {
    const score = computePerformanceScore(
      {
        likes: 300,
        comments: 60,
        shares: 30,
        saves: 90,
        follower_delta: 45
      },
      "instagram",
      buildStats("instagram")
    );

    assert.ok(typeof score === "number");
    assert.ok(score >= 98 && score <= 100);
  });

  it("applies channel weights so save-heavy instagram posts score higher than like-heavy posts", () => {
    const likeHeavy = computePerformanceScore(
      {
        likes: 300,
        comments: 20,
        shares: 10,
        saves: 30,
        follower_delta: 15
      },
      "instagram",
      buildStats("instagram")
    );

    const saveHeavy = computePerformanceScore(
      {
        likes: 100,
        comments: 20,
        shares: 10,
        saves: 90,
        follower_delta: 15
      },
      "instagram",
      buildStats("instagram")
    );

    assert.ok(typeof likeHeavy === "number" && typeof saveHeavy === "number");
    assert.ok(saveHeavy > likeHeavy);
  });

  it("scores naver_blog from views rather than likes", () => {
    const score = computePerformanceScore(
      {
        likes: null,
        views: 3200,
        comments: 45
      },
      "naver_blog",
      buildStats("naver_blog")
    );

    assert.ok(typeof score === "number");
    assert.ok(score >= 70, `expected naver_blog score >= 70, got ${score}`);
  });

  it("scores youtube using views, likes, and comments together", () => {
    const strong = computePerformanceScore(
      {
        views: 8500,
        likes: 420,
        comments: 65
      },
      "youtube",
      buildStats("youtube")
    );
    const weaker = computePerformanceScore(
      {
        views: 1800,
        likes: 110,
        comments: 10
      },
      "youtube",
      buildStats("youtube")
    );

    assert.ok(typeof strong === "number" && typeof weaker === "number");
    assert.ok(strong > weaker);
    assert.ok(strong >= 80, `expected youtube strong score >= 80, got ${strong}`);
  });

  it("computes robust baseline without exploding from outliers", () => {
    const reference = computeRobustReference([50, 55, 60, 65, 6000], 50);
    assert.ok(reference >= 50);
    assert.ok(reference < 200);
  });
});
