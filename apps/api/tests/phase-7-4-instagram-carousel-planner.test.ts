import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeterministicCarouselSlides,
  buildInstagramCarouselExpansionPrompt,
  shouldBackfillInstagramCarousel
} from "../src/orchestrator/skills/instagram-generation/carousel-planner";

describe("Phase 7-4 instagram carousel planner", () => {
  it("backfills carousel planning for normal image posts when slides are missing", () => {
    assert.equal(
      shouldBackfillInstagramCarousel({
        imageMode: "auto",
        topic: "국제개발 협력 현장 이야기",
        caption: "첫 줄 후킹\n현장의 변화를 소개합니다.",
        slides: undefined
      }),
      true
    );
  });

  it("respects explicit single-image requests", () => {
    assert.equal(
      shouldBackfillInstagramCarousel({
        imageMode: "auto",
        topic: "한 장 포스터만 만들어줘",
        caption: "single image only",
        slides: undefined
      }),
      false
    );
  });

  it("builds a 4-slide deterministic fallback plan", () => {
    const slides = buildDeterministicCarouselSlides({
      topic: "아동 교육 지원 캠페인",
      caption: "첫 줄 후킹\n아이들의 변화를 함께 살펴보세요.\n지금 참여가 필요합니다.",
      overlayTexts: {
        title: "교육 지원 캠페인",
        author: "현장의 변화를 소개합니다"
      }
    });

    assert.equal(slides.length, 4);
    assert.equal(slides[0]?.role, "cover");
    assert.equal(slides[3]?.role, "cta");
    assert.ok((slides[1]?.overlayTexts.title ?? "").length > 0);
  });

  it("asks the repair prompt for exactly 4 slides", () => {
    const prompt = buildInstagramCarouselExpansionPrompt({
      topic: "청소년 지원 활동",
      caption: "캡션 본문",
      hashtags: ["#support"],
      overlayTexts: {
        title: "청소년 지원",
        author: "지금 확인해보세요"
      },
      textSlotIds: ["title", "author"]
    });

    assert.match(prompt, /exactly 4 slides/i);
    assert.match(prompt, /"slides"/);
  });
});
