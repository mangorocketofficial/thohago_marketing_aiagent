import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectCampaignDraftReviewIntent } from "../src/orchestrator/skills/campaign-plan/index";

describe("Phase 5-5 campaign draft-review intent detection", () => {
  it("treats '좋다' variants as satisfaction signals", () => {
    const detected = detectCampaignDraftReviewIntent("좋다!");
    assert.equal(detected.revision, false);
    assert.equal(detected.satisfaction, true);
    assert.equal(detected.explicitConfirm, false);
  });

  it("treats compact final approval phrase as explicit confirm", () => {
    const detected = detectCampaignDraftReviewIntent("최종승인할게");
    assert.equal(detected.revision, false);
    assert.equal(detected.explicitConfirm, true);
  });

  it("keeps revision messages as revision intent", () => {
    const detected = detectCampaignDraftReviewIntent("채널 전략 수정해줘");
    assert.equal(detected.revision, true);
    assert.equal(detected.explicitConfirm, false);
  });
});

