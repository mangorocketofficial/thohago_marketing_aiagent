import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { HttpError } from "../src/lib/errors";
import { parseContentBodyPatchInput, type ContentBodyPatchInput } from "../src/routes/contents";
import { routeSkill } from "../src/orchestrator/skills/router";
import type { OrchestratorSessionRow, ResumeEventRequest, SessionState } from "../src/orchestrator/types";

type GoldenMeta = {
  scenario: string;
  description: string;
  is_deterministic: "yes" | "no" | "uncertain";
  created_at: string;
  approved_by: string;
  version: string;
};

type ContentBodyHappyGolden = GoldenMeta & {
  input: {
    body: Record<string, unknown>;
  };
  output: ContentBodyPatchInput;
};

type ContentBodyErrorGolden = GoldenMeta & {
  input: {
    body: Record<string, unknown>;
  };
  output_error: {
    status: number;
    code: string;
    message: string;
  };
};

type RouteSkillDecisionGolden = GoldenMeta & {
  input: {
    event: {
      content: string;
      skill_trigger: string;
    };
    session_current_step: OrchestratorSessionRow["current_step"];
    state_active_skill: string | null;
    state_skill_lock_id: string | null;
  };
  output: {
    skill_id: string;
    reason: string;
    confidence: number | null;
    note?: string;
  } | null;
};

const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

const buildSession = (currentStep: OrchestratorSessionRow["current_step"]): OrchestratorSessionRow => ({
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

const buildState = (params: { activeSkill: string | null; skillLockId: string | null }): SessionState => ({
  trigger_id: "",
  activity_folder: "test-folder",
  file_name: "",
  file_type: "document",
  active_skill: params.activeSkill,
  active_skill_started_at: null,
  active_skill_version: null,
  active_skill_confidence: null,
  skill_lock_id: params.skillLockId,
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
});

const buildUserMessageEvent = (params: {
  content: string;
  skillTrigger: string;
}): ResumeEventRequest => ({
  event_type: "user_message",
  payload: {
    content: params.content,
    skill_trigger: params.skillTrigger
  }
});

const normalizeRouteDecision = (routed: ReturnType<typeof routeSkill>): RouteSkillDecisionGolden["output"] => {
  if (!routed) {
    return null;
  }
  return {
    skill_id: routed.skill.id,
    reason: routed.reason,
    confidence: routed.confidence,
    ...(routed.note ? { note: routed.note } : {})
  };
};

describe("Phase 7-1b golden snapshots", () => {
  it("matches content save-body happy parser golden", () => {
    const golden = loadGolden<ContentBodyHappyGolden>("phase7-1b-happy-content-save-body-parser-20260305-v1.golden.json");
    const parsed = parseContentBodyPatchInput(golden.input.body);
    assert.deepEqual(parsed, golden.output);
  });

  it("matches content save-body invalid expected_updated_at golden", () => {
    const golden = loadGolden<ContentBodyErrorGolden>("phase7-1b-error-content-save-body-invalid-expected-updated-at-20260305-v1.golden.json");
    assert.throws(
      () => parseContentBodyPatchInput(golden.input.body),
      (error: unknown) => {
        assert.equal(error instanceof HttpError, true);
        if (!(error instanceof HttpError)) {
          return false;
        }
        assert.equal(error.status, golden.output_error.status);
        assert.equal(error.code, golden.output_error.code);
        assert.equal(error.message, golden.output_error.message);
        return true;
      }
    );
  });

  it("matches explicit skill-trigger initial routing golden", () => {
    const golden = loadGolden<RouteSkillDecisionGolden>("phase7-1b-edge-explicit-skill-trigger-defer-routing-20260305-v1.golden.json");
    const routed = normalizeRouteDecision(routeSkill({
      event: buildUserMessageEvent({
        content: golden.input.event.content,
        skillTrigger: golden.input.event.skill_trigger
      }),
      session: buildSession(golden.input.session_current_step),
      state: buildState({
        activeSkill: golden.input.state_active_skill,
        skillLockId: golden.input.state_skill_lock_id
      })
    }));
    assert.deepEqual(routed, golden.output);
  });
});
