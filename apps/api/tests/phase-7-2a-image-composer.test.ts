import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { composeInstagramImage } from "../src/media/image-composer";

describe("Phase 7-2a image composer", () => {
  it("composes 1080x1080 png with text-only template", async () => {
    const result = await composeInstagramImage({
      templateId: "text-only-gradient",
      userImages: [],
      overlayMainText: "봄맞이 이벤트",
      overlaySubText: "지금 신청하세요",
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
