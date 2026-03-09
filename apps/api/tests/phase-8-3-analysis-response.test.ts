import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePerformanceAnalysisResponse } from "../src/analytics/analysis-response";

describe("phase 8-3 analysis response parser", () => {
  it("parses fenced json and trims action items", () => {
    const parsed = parsePerformanceAnalysisResponse(
      [
        "```json",
        JSON.stringify({
          summary: "이번 주 인스타그램 성과가 상승했습니다.",
          key_actions: ["  릴스 업로드 빈도를 유지합니다.  ", "스토리 CTA 문구를 반복 사용합니다."],
          markdown: "## 실행 요약\n\n핵심 포인트를 정리했습니다."
        }),
        "```"
      ].join("\n"),
      14,
      ["report-1", "report-2"],
      "claude"
    );

    assert.equal(parsed.summary, "이번 주 인스타그램 성과가 상승했습니다.");
    assert.deepEqual(parsed.key_actions, ["릴스 업로드 빈도를 유지합니다.", "스토리 CTA 문구를 반복 사용합니다."]);
    assert.equal(parsed.markdown, "## 실행 요약\n\n핵심 포인트를 정리했습니다.");
    assert.equal(parsed.content_count, 14);
    assert.equal(parsed.model_used, "claude");
    assert.deepEqual(parsed.compared_report_ids, ["report-1", "report-2"]);
    assert.ok(!Number.isNaN(Date.parse(parsed.analyzed_at)));
  });

  it("extracts a json object from surrounding prose", () => {
    const parsed = parsePerformanceAnalysisResponse(
      [
        "Here is the analysis payload.",
        JSON.stringify({
          summary: "블로그 전환 콘텐츠가 안정적으로 반응했습니다.",
          key_actions: ["후속 전환형 포스트를 추가 발행합니다.", "상위 CTA를 제목에도 반영합니다."],
          markdown: "## 채널별 분석\n\n네이버 블로그 반응이 높았습니다."
        }),
        "Use this for the final report."
      ].join("\n"),
      9,
      [],
      "gpt-4o-mini"
    );

    assert.equal(parsed.summary, "블로그 전환 콘텐츠가 안정적으로 반응했습니다.");
    assert.deepEqual(parsed.key_actions, ["후속 전환형 포스트를 추가 발행합니다.", "상위 CTA를 제목에도 반영합니다."]);
    assert.equal(parsed.model_used, "gpt-4o-mini");
  });

  it("throws when required fields are missing", () => {
    assert.throws(
      () =>
        parsePerformanceAnalysisResponse(
          JSON.stringify({
            summary: "요약은 있지만",
            key_actions: [],
            markdown: ""
          }),
          5,
          [],
          "claude"
        ),
      /missing required fields/i
    );
  });
});
