import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSessionTitleFromFirstUserMessage } from "../src/orchestrator/session-title";

describe("Phase 6-4a session title generation", () => {
  it("uses the first sentence when available", () => {
    const title = buildSessionTitleFromFirstUserMessage(
      "이번 달 인스타그램 캠페인 기획안을 만들어줘. 톤은 따뜻하게."
    );
    assert.equal(title, "이번 달 인스타그램 캠페인 기획안을 만들어줘.");
  });

  it("truncates long messages with ellipsis", () => {
    const title = buildSessionTitleFromFirstUserMessage(
      "브랜드 소개 글을 기반으로 4주 콘텐츠 캘린더와 채널별 메시지 매트릭스를 동시에 구성해줘 그리고 예산안도 함께 제안해줘"
    );
    assert.equal(title.endsWith("..."), true);
    assert.equal(title.length <= 42, true);
  });

  it("is deterministic for identical input", () => {
    const input = "유튜브 숏츠 중심 신규 캠페인 초안을 잡아줘";
    const left = buildSessionTitleFromFirstUserMessage(input);
    const right = buildSessionTitleFromFirstUserMessage(input);
    assert.equal(left, right);
  });
});
