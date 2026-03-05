import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { matchInstagramIntent } from "../src/orchestrator/skills/instagram-generation/intent";
import { parseInstagramDraft } from "../src/orchestrator/skills/instagram-generation/prompt";
import { advanceInstagramSurvey } from "../src/orchestrator/skills/instagram-generation/survey";
import type { InstagramDraft, InstagramSurveyState } from "../src/orchestrator/skills/instagram-generation/types";
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

type SurveyGolden = GoldenMeta & {
  input: {
    state: InstagramSurveyState;
    user_message: string;
  };
  output: {
    state: InstagramSurveyState;
    assistantMessage: string;
    ready: boolean;
  };
};

type DraftGolden = GoldenMeta & {
  input: {
    llm_text: string;
  };
  output: InstagramDraft;
};

const loadGolden = <T>(fileName: string): T => {
  const raw = readFileSync(new URL(`./golden/${fileName}`, import.meta.url), "utf8");
  return JSON.parse(raw) as T;
};

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

describe("Phase 7-2a golden snapshots", () => {
  it("matches instagram intent strong phrase golden", () => {
    const golden = loadGolden<IntentGolden>("phase7-2a-happy-instagram-intent-strong-phrase-20260305-v1.golden.json");
    const matched = matchInstagramIntent(buildIntentInput(golden.input));
    assert.deepEqual(matched, golden.output);
  });

  it("matches instagram survey topic->image selection golden", () => {
    const golden = loadGolden<SurveyGolden>("phase7-2a-happy-instagram-survey-topic-to-image-20260305-v1.golden.json");
    const advanced = advanceInstagramSurvey(golden.input.state, golden.input.user_message);
    assert.deepEqual(advanced, golden.output);
  });

  it("matches instagram draft parser wrapped-json golden", () => {
    const golden = loadGolden<DraftGolden>("phase7-2a-edge-instagram-draft-parser-wrapped-json-20260305-v1.golden.json");
    const parsed = parseInstagramDraft(golden.input.llm_text);
    assert.deepEqual(parsed, golden.output);
  });
});
