import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ANALYTICS_CHANNELS, parseAccumulatedInsights } from "@repo/analytics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const loadFixture = async () => {
  const raw = await readFile(resolve(__dirname, "fixtures/wfk-dummy-insights.json"), "utf-8");
  return JSON.parse(raw);
};

describe("WFK dummy insights fixture", () => {
  it("parses successfully via parseAccumulatedInsights", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw);

    assert.ok(parsed, "parseAccumulatedInsights should return non-null for valid fixture");
    assert.equal(parsed.generated_at, "2026-03-07T09:00:00.000Z");
    assert.equal(parsed.content_count_at_generation, 87);
  });

  it("contains every analytics channel in best publish times and recommendations", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    for (const channel of ANALYTICS_CHANNELS) {
      assert.ok(parsed.best_publish_times[channel], `missing best_publish_times for ${channel}`);
      assert.ok(parsed.channel_recommendations[channel], `missing channel_recommendations for ${channel}`);
    }
  });

  it("keeps CTA phrases and readable summary strings", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    assert.ok(parsed.top_cta_phrases.length >= 3, "should have at least 3 CTA phrases");
    assert.ok(parsed.content_pattern_summary.startsWith("총 87개 콘텐츠"));
    assert.ok(parsed.user_edit_preference_summary.startsWith("총 45회 수정 요청"));
  });
});
