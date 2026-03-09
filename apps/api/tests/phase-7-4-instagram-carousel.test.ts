import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveLegacyInstagramFields, normalizeInstagramSlides } from "../src/orchestrator/instagram-slides-shared";
import { parseInstagramDraft } from "../src/orchestrator/skills/instagram-generation/prompt";

describe("Phase 7-4 instagram carousel support", () => {
  it("parses carousel slides from prompt output", () => {
    const parsed = parseInstagramDraft(`{
      "caption": "Campaign intro",
      "hashtags": ["#campaign"],
      "slides": [
        {
          "role": "cover",
          "overlay_texts": { "title": "Welcome", "author": "Launch" }
        },
        {
          "role": "cta",
          "overlay_texts": { "title": "Apply now", "author": "Join us" }
        }
      ]
    }`);

    assert.equal(parsed.caption, "Campaign intro");
    assert.deepEqual(parsed.hashtags, ["#campaign"]);
    assert.equal(parsed.slides?.length, 2);
    assert.deepEqual(parsed.slides?.[0], {
      role: "cover",
      overlayTexts: {
        title: "Welcome",
        author: "Launch"
      }
    });
    assert.deepEqual(parsed.overlayTexts, {
      title: "Welcome",
      author: "Launch"
    });
  });

  it("normalizes legacy metadata into one slide using full top-level image arrays", () => {
    const slides = normalizeInstagramSlides({
      template_id: "koica_story_02",
      overlay_texts: {
        title: "Legacy"
      },
      image_file_ids: ["file-1", "file-2"],
      image_paths: ["images/1.jpg", "images/2.jpg"]
    });

    assert.deepEqual(slides, [
      {
        slideIndex: 0,
        templateId: "koica_story_02",
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
        templateId: "koica_cover_01",
        role: "cover",
        overlayTexts: {
          title: "Welcome"
        },
        imageFileIds: ["slide-0-image"],
        imagePaths: ["slides/0.jpg"]
      },
      {
        slideIndex: 1,
        templateId: "koica_cta_04",
        role: "cta",
        overlayTexts: {
          title: "Apply"
        },
        imageFileIds: ["slide-1-image"],
        imagePaths: ["slides/1.jpg"]
      }
    ]);

    assert.deepEqual(legacy, {
      templateId: "koica_cover_01",
      overlayTexts: {
        title: "Welcome"
      },
      imageFileIds: ["slide-0-image"],
      imagePaths: ["slides/0.jpg"],
      isCarousel: true
    });
  });

  it("normalizes explicit slide template ids and preserves order", () => {
    const slides = normalizeInstagramSlides({
      template_id: "koica_cover_01",
      slides: [
        {
          slide_index: 2,
          template_id: "koica_cta_04",
          role: "cta",
          overlay_texts: {
            title: "Last"
          }
        },
        {
          slide_index: 1,
          role: "detail",
          overlay_texts: {
            title: "Middle"
          }
        }
      ]
    });

    assert.deepEqual(slides, [
      {
        slideIndex: 0,
        templateId: "koica_cover_01",
        role: "detail",
        overlayTexts: {
          title: "Middle"
        },
        imageFileIds: [],
        imagePaths: []
      },
      {
        slideIndex: 1,
        templateId: "koica_cta_04",
        role: "cta",
        overlayTexts: {
          title: "Last"
        },
        imageFileIds: [],
        imagePaths: []
      }
    ]);
  });
});
