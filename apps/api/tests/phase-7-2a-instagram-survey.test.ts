import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceInstagramSurvey, startInstagramSurvey } from "../src/orchestrator/skills/instagram-generation/survey";

describe("Phase 7-2a instagram survey", () => {
  it("progresses topic -> image selection", () => {
    const started = startInstagramSurvey();
    const advanced = advanceInstagramSurvey(started.state, "봄 행사 홍보");

    assert.equal(advanced.ready, false);
    assert.equal(advanced.state.phase, "image_selection");
    assert.equal(advanced.state.topic, "봄 행사 홍보");
  });

  it("completes immediately in text-only mode with koica template", () => {
    const started = startInstagramSurvey();
    const withTopic = advanceInstagramSurvey(started.state, "지역 축제 공지");
    const completed = advanceInstagramSurvey(withTopic.state, "3");

    assert.equal(completed.ready, true);
    assert.equal(completed.state.phase, "complete");
    assert.equal(completed.state.imageMode, "text_only");
    assert.equal(completed.state.templateId, "koica_cover_01");
  });

  it("uses koica template on template selection step", () => {
    const started = startInstagramSurvey();
    const withTopic = advanceInstagramSurvey(started.state, "행사 스토리");
    const withImageMode = advanceInstagramSurvey(withTopic.state, "1");
    const withTemplate = advanceInstagramSurvey(withImageMode.state, "1");

    assert.equal(withTemplate.ready, true);
    assert.equal(withTemplate.state.templateId, "koica_cover_01");
  });
});
