import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrgChannelStats } from "../src/rag/performance-scorer";
import { computePerformanceScore, computeRobustReference } from "../src/rag/performance-scorer";

const baseStats: OrgChannelStats = {
  channel: "instagram",
  sample_count: 12,
  references: {
    likes: 100,
    comments: 20,
    shares: 10,
    saves: 30,
    follower_delta: 15
  }
};

describe("performance-scorer", () => {
  it("returns null when no metrics are present", () => {
    const score = computePerformanceScore(
      {
        likes: null,
        comments: null,
        shares: null,
        saves: null,
        follower_delta: null
      },
      "instagram",
      baseStats
    );
    assert.equal(score, null);
  });

  it("scores baseline performance near 50", () => {
    const score = computePerformanceScore(
      {
        likes: 100,
        comments: 20,
        shares: 10,
        saves: 30,
        follower_delta: 15
      },
      "instagram",
      baseStats
    );

    assert.ok(typeof score === "number");
    assert.ok((score as number) >= 49 && (score as number) <= 51);
  });

  it("scores strong outperformance close to 100", () => {
    const score = computePerformanceScore(
      {
        likes: 300,
        comments: 60,
        shares: 30,
        saves: 90,
        follower_delta: 45
      },
      "instagram",
      baseStats
    );

    assert.ok(typeof score === "number");
    assert.ok((score as number) >= 98 && (score as number) <= 100);
  });

  it("applies channel weights so save-heavy posts score higher than like-heavy posts", () => {
    const likeHeavy = computePerformanceScore(
      {
        likes: 300,
        comments: 20,
        shares: 10,
        saves: 30,
        follower_delta: 15
      },
      "instagram",
      baseStats
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
      baseStats
    );

    assert.ok(typeof likeHeavy === "number" && typeof saveHeavy === "number");
    assert.ok(saveHeavy > likeHeavy);
  });

  it("computes robust baseline without exploding from outliers", () => {
    const reference = computeRobustReference([50, 55, 60, 65, 6000], 50);
    assert.ok(reference >= 50);
    assert.ok(reference < 200);
  });
});

