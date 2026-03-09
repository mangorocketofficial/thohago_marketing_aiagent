import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeSkill } from "../src/orchestrator/skills/router";
import type { OrchestratorSessionRow, ResumeEventRequest, SessionState } from "../src/orchestrator/types";

const buildSession = (currentStep: OrchestratorSessionRow["current_step"] = "await_user_input"): OrchestratorSessionRow => ({
  id: "session-1",
  org_id: "org-1",
  trigger_id: null,
  workspace_type: "general",
  scope_id: "default",
  title: null,
  created_by_user_id: null,
  archived_at: null,
  state: {},
  current_step: currentStep,
  status: "paused",
  created_at: "2026-03-05T00:00:00.000Z",
  updated_at: "2026-03-05T00:00:00.000Z"
});

const buildState = (overrides?: Partial<SessionState>): SessionState => ({
  trigger_id: "",
  activity_folder: "test-folder",
  file_name: "",
  file_type: "document",
  active_skill: null,
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
  last_error: null,
  ...(overrides ?? {})
});

const buildUserMessageEvent = (content: string, skillTrigger?: string): ResumeEventRequest => ({
  event_type: "user_message",
  payload: {
    content,
    ...(skillTrigger ? { skill_trigger: skillTrigger } : {})
  }
});

describe("Phase 7-1b skill routing guardrails", () => {
  it("routes explicit skill trigger immediately when no active skill exists", () => {
    const routed = routeSkill({
      event: buildUserMessageEvent("write blog post", "naverblog_generation"),
      session: buildSession(),
      state: buildState()
    });

    assert.ok(routed);
    assert.equal(routed?.reason, "explicit_trigger");
    assert.equal(routed?.skill.id, "naverblog_generation");
  });

  it("reaffirms the explicitly selected skill even when it is already active", () => {
    const routed = routeSkill({
      event: buildUserMessageEvent("spring interior tips", "naverblog_generation"),
      session: buildSession("await_content_approval"),
      state: buildState({
        active_skill: "naverblog_generation"
      })
    });

    assert.ok(routed);
    assert.equal(routed?.reason, "explicit_trigger");
    assert.equal(routed?.skill.id, "naverblog_generation");
  });

  it("allows explicit skill trigger to override a different pinned skill", () => {
    const routed = routeSkill({
      event: buildUserMessageEvent("create instagram card for recruitment", "instagram_generation"),
      session: buildSession(),
      state: buildState({
        active_skill: "naverblog_generation",
        skill_lock_id: "naverblog_generation"
      })
    });

    assert.ok(routed);
    assert.equal(routed?.reason, "explicit_trigger");
    assert.equal(routed?.skill.id, "instagram_generation");
  });

  it("allows strong cross-skill intent to override pinned skill without explicit trigger", () => {
    const routed = routeSkill({
      event: buildUserMessageEvent("create instagram post for recruitment"),
      session: buildSession(),
      state: buildState({
        active_skill: "naverblog_generation",
        skill_lock_id: "naverblog_generation"
      })
    });

    assert.ok(routed);
    assert.equal(routed?.reason, "intent");
    assert.equal(routed?.skill.id, "instagram_generation");
  });

  it("keeps instagram routing for explicit instagram trigger on posting phrasing", () => {
    const routed = routeSkill({
      event: buildUserMessageEvent("인스타그램 포스팅 작성", "instagram_generation"),
      session: buildSession(),
      state: buildState({
        active_skill: "instagram_generation",
        skill_lock_id: "instagram_generation"
      })
    });

    assert.ok(routed);
    assert.equal(routed?.reason, "explicit_trigger");
    assert.equal(routed?.skill.id, "instagram_generation");
  });
});
