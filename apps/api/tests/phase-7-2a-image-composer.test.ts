import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { composeInstagramImage } from "@repo/media-engine";

describe("Phase 7-2a image composer", () => {
  it("composes 1080x1080 png with koica template and id-based text map", async () => {
    const result = await composeInstagramImage({
      templateId: "koica_cover_01",
      userImages: [],
      overlayTexts: {
        contest_info: "Contest 안내",
        title: "나의 한 페이지",
        author: "홍길동",
        award_badge: "우수상"
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
