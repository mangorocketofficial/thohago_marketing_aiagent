import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { composeInstagramImage } from "@repo/media-engine";

const fixtureImagePath = fileURLToPath(
  new URL("../../../assets/template1/composite_test_01.png", import.meta.url)
);

describe("Phase 7-2a image composer", () => {
  it("composes 1080x1080 png with koica template and id-based text map", async () => {
    const result = await composeInstagramImage({
      templateId: "koica_cover_01",
      userImages: [path.resolve(fixtureImagePath)],
      overlayTexts: {
        contest_info: "Contest intro",
        title: "One page of life",
        author: "Hong",
        badge_text: "Award"
      },
      outputFormat: "png"
    });

    const metadata = await sharp(result.buffer).metadata();
    assert.equal(result.format, "png");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1080);
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1080);
  });
});
