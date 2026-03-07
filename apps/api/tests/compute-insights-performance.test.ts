import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPerformanceAwareRecommendations,
  computeBestPublishTimes,
  extractTopCtaPhrases
} from "../src/rag/compute-insights";

describe("compute-insights performance helpers", () => {
  it("computes best publish windows with explicit timezone output", () => {
    const rows = [
      { channel: "instagram", published_at: "2026-03-07T09:10:00.000Z", performance_score: 82 },
      { channel: "instagram", published_at: "2026-03-08T09:40:00.000Z", performance_score: 75 },
      { channel: "instagram", published_at: "2026-03-07T01:10:00.000Z", performance_score: 45 },
      { channel: "instagram", published_at: "2026-03-08T01:20:00.000Z", performance_score: 43 }
    ];

    const best = computeBestPublishTimes(rows, "Asia/Seoul");
    assert.ok(best.instagram);
    assert.ok(best.instagram.startsWith("18:00-20:00"));
    assert.ok(best.instagram.includes("(Asia/Seoul)"));
  });

  it("extracts CTA phrases only from high-performing rows", () => {
    const phrases = extractTopCtaPhrases([
      { body: "지금 클릭해서 신청해보세요. 프로필 링크 확인!", performance_score: 82 },
      { body: "Click now and learn more about this campaign.", performance_score: 78 },
      { body: "click now to sign up", performance_score: 74 },
      { body: "지금 클릭", performance_score: 40 }
    ]);

    assert.ok(phrases.includes("지금 클릭"));
    assert.ok(phrases.includes("click now"));
    assert.ok(!phrases.includes("sign up") || phrases.length <= 5);
  });

  it("builds recommendations with quality + confidence signals", () => {
    const recommendations = buildPerformanceAwareRecommendations(
      { instagram: 18, facebook: 6, threads: 2 },
      { instagram: 73.2, facebook: 51.4 },
      { instagram: 14, facebook: 4 }
    );

    assert.ok(recommendations.instagram.includes("Strong performance"));
    assert.ok(recommendations.facebook.includes("low-confidence"));
    assert.ok(recommendations.threads.includes("Increase publishing frequency"));
  });
});

