import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { matchNaverBlogIntent } from "../src/orchestrator/skills/naverblog-generation/intent";
import { parseSlotRow, type ScheduleSlotRow } from "../src/orchestrator/skills/naverblog-generation/types";
import type { SkillIntentInput, SkillIntentMatch } from "../src/orchestrator/skills/types";

type GoldenMeta = {
  scenario: string;
  description: string;
  is_deterministic: "yes" | "no" | "uncertain";
  created_at: string;
  approved_by: string;
  version: string;
};

type IntentGolden = GoldenMeta & {
  input: {
    message: string;
    current_step: string;
    active_skill: string | null;
  };
  output: SkillIntentMatch | null;
};

type ParseSlotRowGolden = GoldenMeta & {
  input: {
    row: Record<string, unknown>;
  };
  output: ScheduleSlotRow;
};

/**
 * Build a minimum valid intent input fixture for skill intent matching tests.
 */
const buildIntentInput = (params: IntentGolden["input"]): SkillIntentInput => ({
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
    current_step: params.current_step as SkillIntentInput["session"]["current_step"],
    status: "paused",
    created_at: "2026-03-05T00:00:00.000Z",
    updated_at: "2026-03-05T00:00:00.000Z"
  },
  state: {
    trigger_id: "",
    activity_folder: "test-folder",
    file_name: "",
    file_type: "document",
    active_skill: params.active_skill,
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

/**
 * Read a 7-1a golden JSON snapshot from tests/golden.
 */
const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

describe("Phase 7-1a golden snapshots", () => {
  it("matches strong naver blog intent golden", () => {
    const golden = loadGolden<IntentGolden>("phase7-1a-happy-naver-blog-intent-strong-phrase-20260305-v1.golden.json");
    const matched = matchNaverBlogIntent(buildIntentInput(golden.input));
    assert.deepEqual(matched, golden.output);
  });

  it("matches query-only naver blog intent non-match golden", () => {
    const golden = loadGolden<IntentGolden>("phase7-1a-edge-naver-blog-intent-query-only-20260305-v1.golden.json");
    const matched = matchNaverBlogIntent(buildIntentInput(golden.input));
    assert.deepEqual(matched, golden.output);
  });

  it("matches slot row normalization golden", () => {
    const golden = loadGolden<ParseSlotRowGolden>("phase7-1a-edge-slot-row-normalization-20260305-v1.golden.json");
    const parsed = parseSlotRow(golden.input.row);
    assert.deepEqual(parsed, golden.output);
  });
});
