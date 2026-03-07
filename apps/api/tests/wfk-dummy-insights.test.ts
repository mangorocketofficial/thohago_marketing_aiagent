import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseAccumulatedInsights } from "../src/rag/data";

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

  it("contains all 5 channels in best_publish_times", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    const channels = ["naver_blog", "instagram", "youtube", "facebook", "threads"];
    for (const ch of channels) {
      assert.ok(parsed.best_publish_times[ch], `missing best_publish_times for ${ch}`);
    }
  });

  it("contains all 5 channels in channel_recommendations", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    const channels = ["naver_blog", "instagram", "youtube", "facebook", "threads"];
    for (const ch of channels) {
      assert.ok(parsed.channel_recommendations[ch], `missing channel_recommendations for ${ch}`);
    }
  });

  it("has CTA phrases array with entries", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    assert.ok(parsed.top_cta_phrases.length >= 3, "should have at least 3 CTA phrases");
  });

  it("content_count_at_generation matches pattern summary total", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    const match = parsed.content_pattern_summary.match(/총 (\d+)개/);
    assert.ok(match, "content_pattern_summary should contain total count");
    assert.equal(Number(match[1]), parsed.content_count_at_generation);
  });

  it("user_edit_preference_summary follows expected format", async () => {
    const raw = await loadFixture();
    const parsed = parseAccumulatedInsights(raw)!;

    assert.ok(parsed.user_edit_preference_summary.startsWith("총"), "should start with 총");
    assert.ok(parsed.user_edit_preference_summary.includes("회 수정"), "should contain 회 수정");
  });
});
