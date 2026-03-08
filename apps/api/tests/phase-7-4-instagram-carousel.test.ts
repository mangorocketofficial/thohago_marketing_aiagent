import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveLegacyInstagramFields, normalizeInstagramSlides } from "../src/orchestrator/instagram-slides-shared";
import { parseInstagramDraft } from "../src/orchestrator/skills/instagram-generation/prompt";

describe("Phase 7-4 instagram carousel support", () => {
  it("parses carousel slides from prompt output", () => {
    const parsed = parseInstagramDraft(`{
      "caption": "캠페인 소개",
      "hashtags": ["#campaign"],
      "slides": [
        {
          "role": "cover",
          "overlay_texts": { "title": "첫 장", "author": "소개" }
        },
        {
          "role": "cta",
          "overlay_texts": { "title": "함께해요", "author": "지금 참여" }
        }
      ]
    }`);

    assert.equal(parsed.caption, "캠페인 소개");
    assert.deepEqual(parsed.hashtags, ["#campaign"]);
    assert.equal(parsed.slides?.length, 2);
    assert.deepEqual(parsed.slides?.[0], {
      role: "cover",
      overlayTexts: {
        title: "첫 장",
        author: "소개"
      }
    });
    assert.deepEqual(parsed.overlayTexts, {
      title: "첫 장",
      author: "소개"
    });
  });

  it("normalizes legacy metadata into one slide using full top-level image arrays", () => {
    const slides = normalizeInstagramSlides({
      overlay_texts: {
        title: "Legacy"
      },
      image_file_ids: ["file-1", "file-2"],
      image_paths: ["images/1.jpg", "images/2.jpg"]
    });

    assert.deepEqual(slides, [
      {
        slideIndex: 0,
        role: "custom",
        overlayTexts: {
          title: "Legacy"
        },
        imageFileIds: ["file-1", "file-2"],
        imagePaths: ["images/1.jpg", "images/2.jpg"]
      }
    ]);
  });

  it("derives legacy fields from slide zero for compatibility", () => {
    const legacy = deriveLegacyInstagramFields([
      {
        slideIndex: 0,
        role: "cover",
        overlayTexts: {
          title: "첫 장"
        },
        imageFileIds: ["slide-0-image"],
        imagePaths: ["slides/0.jpg"]
      },
      {
        slideIndex: 1,
        role: "cta",
        overlayTexts: {
          title: "둘째 장"
        },
        imageFileIds: ["slide-1-image"],
        imagePaths: ["slides/1.jpg"]
      }
    ]);

    assert.deepEqual(legacy, {
      overlayTexts: {
        title: "첫 장"
      },
      imageFileIds: ["slide-0-image"],
      imagePaths: ["slides/0.jpg"],
      isCarousel: true
    });
  });
});
