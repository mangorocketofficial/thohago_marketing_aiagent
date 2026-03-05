import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchInstagramIntent } from "../src/orchestrator/skills/instagram-generation/intent";
import type { SkillIntentInput } from "../src/orchestrator/skills/types";

const buildInput = (params: {
  message: string;
  currentStep?: string;
  activeSkill?: string | null;
}): SkillIntentInput => ({
  session: {
    id: "session-1",
    org_id: "org-1",
    trigger_id: null,
    workspace_type: "general",
    scope_id: "default",
    title: null,
    created_by_user_id: null,
    archived_at: null,
    state: {},
    current_step: (params.currentStep ?? "await_user_input") as SkillIntentInput["session"]["current_step"],
    status: "paused",
    created_at: "2026-03-05T00:00:00.000Z",
    updated_at: "2026-03-05T00:00:00.000Z"
  },
  state: {
    trigger_id: "",
    activity_folder: "test-folder",
    file_name: "",
    file_type: "document",
    active_skill: params.activeSkill ?? null,
    active_skill_started_at: null,
    active_skill_version: null,
    active_skill_confidence: null,
    skill_lock_id: null,
    skill_lock_source: null,
    skill_lock_at: null,
    user_message: null,
    campaign_id: null,
    campaign_survey: null,
    instagram_survey: null,
    campaign_draft_version: 0,
    campaign_chain_data: null,
    campaign_plan_document: null,
    campaign_workflow_item_id: null,
    campaign_plan: null,
    content_id: null,
    content_workflow_item_id: null,
    content_draft: null,
    rag_context: null,
    forbidden_check: null,
    processed_event_ids: [],
    last_error: null
  },
  normalizedMessage: params.message,
  tokens: params.message.split(/\s+/).filter(Boolean)
});

describe("Phase 7-2a instagram intent", () => {
  it("matches strong phrase", () => {
    const matched = matchInstagramIntent(
      buildInput({
        message: "인스타 게시물 만들어"
      })
    );

    assert.ok(matched);
    assert.equal(matched?.confidence, 0.95);
  });

  it("matches platform + action phrase", () => {
    const matched = matchInstagramIntent(
      buildInput({
        message: "instagram post generate"
      })
    );

    assert.ok(matched);
    assert.ok((matched?.confidence ?? 0) >= 0.88);
  });

  it("ignores analytics query wording", () => {
    const matched = matchInstagramIntent(
      buildInput({
        message: "인스타 통계 분석"
      })
    );

    assert.equal(matched, null);
  });

  it("continues active skill even outside await_user_input step", () => {
    const matched = matchInstagramIntent(
      buildInput({
        message: "아무 말",
        currentStep: "await_content_approval",
        activeSkill: "instagram_generation"
      })
    );

    assert.ok(matched);
    assert.equal(matched?.confidence, 1);
  });
});
