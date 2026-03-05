import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceInstagramSurvey, startInstagramSurvey } from "../src/orchestrator/skills/instagram-generation/survey";

describe("Phase 7-2a instagram survey", () => {
  it("progresses topic -> image selection", () => {
    const started = startInstagramSurvey();
    const advanced = advanceInstagramSurvey(started.state, "봄 나들이 행사 홍보");

    assert.equal(advanced.ready, false);
    assert.equal(advanced.state.phase, "image_selection");
    assert.equal(advanced.state.topic, "봄 나들이 행사 홍보");
  });

  it("completes immediately in text-only mode", () => {
    const started = startInstagramSurvey();
    const withTopic = advanceInstagramSurvey(started.state, "지역 축제 공지");
    const completed = advanceInstagramSurvey(withTopic.state, "3");

    assert.equal(completed.ready, true);
    assert.equal(completed.state.phase, "complete");
    assert.equal(completed.state.imageMode, "text_only");
    assert.equal(completed.state.templateId, "text-only-gradient");
  });

  it("selects collage template from template step", () => {
    const started = startInstagramSurvey();
    const withTopic = advanceInstagramSurvey(started.state, "봉사활동 후기");
    const withImageMode = advanceInstagramSurvey(withTopic.state, "1");
    const withTemplate = advanceInstagramSurvey(withImageMode.state, "3");

    assert.equal(withTemplate.ready, true);
    assert.equal(withTemplate.state.templateId, "collage-2x2");
  });
});
