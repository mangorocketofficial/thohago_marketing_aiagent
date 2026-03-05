import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchNaverBlogIntent } from "../src/orchestrator/skills/naverblog-generation/intent";
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

describe("Phase 7-1a naver blog intent", () => {
  it("matches strong Korean phrase", () => {
    const match = matchNaverBlogIntent(buildInput({
      message: "네이버 블로그 글 써줘"
    }));

    assert.ok(match);
    assert.equal(match?.confidence, 0.95);
  });

  it("matches blog noun + action", () => {
    const match = matchNaverBlogIntent(buildInput({
      message: "blog post generate"
    }));

    assert.ok(match);
    assert.equal(match?.confidence, 0.88);
  });

  it("does not match query-only wording", () => {
    const match = matchNaverBlogIntent(buildInput({
      message: "네이버 블로그 상태 확인"
    }));

    assert.equal(match, null);
  });

  it("continues active naver blog skill regardless of step", () => {
    const match = matchNaverBlogIntent(buildInput({
      message: "아무 말",
      currentStep: "await_content_approval",
      activeSkill: "naverblog_generation"
    }));

    assert.ok(match);
    assert.equal(match?.confidence, 1);
  });
});
