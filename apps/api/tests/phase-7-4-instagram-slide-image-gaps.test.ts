import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillInstagramSlideImageGaps } from "@repo/types";

describe("Phase 7-4 instagram slide image gap filling", () => {
  it("fills missing slide image slots by cycling available images", () => {
    const slides = fillInstagramSlideImageGaps(
      [
        {
          slideIndex: 0,
          role: "cover",
          overlayTexts: {},
          imageFileIds: ["file-1"],
          imagePaths: ["images/1.jpg"]
        },
        {
          slideIndex: 1,
          role: "detail",
          overlayTexts: {},
          imageFileIds: ["file-2"],
          imagePaths: ["images/2.jpg"]
        },
        {
          slideIndex: 2,
          role: "cta",
          overlayTexts: {},
          imageFileIds: [],
          imagePaths: []
        }
      ],
      1
    );

    assert.equal(slides.length, 3);
    assert.deepEqual(slides[2]?.imageFileIds, ["file-1"]);
    assert.deepEqual(slides[2]?.imagePaths, ["images/1.jpg"]);
  });

  it("leaves complete slide image assignments unchanged", () => {
    const slides = fillInstagramSlideImageGaps(
      [
        {
          slideIndex: 0,
          role: "cover",
          overlayTexts: {},
          imageFileIds: ["file-1"],
          imagePaths: ["images/1.jpg"]
        },
        {
          slideIndex: 1,
          role: "cta",
          overlayTexts: {},
          imageFileIds: ["file-2"],
          imagePaths: ["images/2.jpg"]
        }
      ],
      1
    );

    assert.deepEqual(
      slides.map((slide) => slide.imagePaths),
      [["images/1.jpg"], ["images/2.jpg"]]
    );
  });
});
