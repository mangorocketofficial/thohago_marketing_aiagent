import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SURVEY_QUESTIONS,
  buildChainInputFromSurvey,
  buildPendingQuestions,
  canEarlyExit,
  extractAnswersFromInitialMessage,
  isSurveyComplete,
  parseSurveyAnswer
} from "../src/orchestrator/skills/campaign-plan/survey";
import type { SurveyAnswer } from "../src/orchestrator/types";

describe("Phase 5-5 campaign survey", () => {
  it("includes direct input choice in every survey question", () => {
    for (const question of SURVEY_QUESTIONS) {
      assert.ok(Array.isArray(question.choices) && question.choices.includes("직접 입력"));
    }
  });

  it("extracts goal and channels from initial message", async () => {
    const answers = await extractAnswersFromInitialMessage("Please plan an awareness campaign on Instagram.");
    const goal = answers.find((entry) => entry.question_id === "campaign_goal");
    const channels = answers.find((entry) => entry.question_id === "channels");

    assert.equal(goal?.answer, "Awareness");
    assert.match(channels?.answer ?? "", /Instagram/i);
  });

  it("allows early exit when required answers are filled and only optional remain", async () => {
    const answers: SurveyAnswer[] = [
      {
        question_id: "campaign_goal",
        answer: "Awareness",
        source: "user",
        answered_at: "2026-03-04T10:00:00.000Z"
      },
      {
        question_id: "channels",
        answer: "Instagram",
        source: "user",
        answered_at: "2026-03-04T10:00:00.000Z"
      }
    ];

    const pending = buildPendingQuestions(SURVEY_QUESTIONS, answers);
    assert.equal(canEarlyExit({ answers, pendingQuestions: pending }), true);
    assert.equal(
      isSurveyComplete({
        answers,
        pendingQuestions: pending,
        earlyExitRequested: true
      }),
      true
    );
  });

  it("accepts auto-fill suggestion on affirmative answer", async () => {
    const parsed = await parseSurveyAnswer({
      userMessage: "네",
      pendingQuestions: ["channels"],
      autoFillData: {
        channels: "Instagram, Threads"
      }
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.question_id, "channels");
    assert.equal(parsed[0]?.answer, "Instagram, Threads");
    assert.equal(parsed[0]?.source, "auto_filled");
  });

  it("parses indexed explicit choice", async () => {
    const parsed = await parseSurveyAnswer({
      userMessage: "2",
      pendingQuestions: ["campaign_goal"],
      autoFillData: {}
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.question_id, "campaign_goal");
    assert.equal(parsed[0]?.answer, "Engagement");
  });

  it("keeps pending when direct-input option is selected without payload", async () => {
    const parsed = await parseSurveyAnswer({
      userMessage: "4",
      pendingQuestions: ["campaign_goal"],
      autoFillData: {}
    });

    assert.equal(parsed.length, 0);
  });

  it("uses llm helper for direct input mapping", async () => {
    const parsed = await parseSurveyAnswer({
      userMessage: "직접입력: 브랜드 인지도 확대",
      pendingQuestions: ["campaign_goal"],
      autoFillData: {},
      classifyDirectInput: async () => ({
        answer: "Awareness",
        confidence: 0.91,
        reason: "mapped_to_goal"
      })
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.question_id, "campaign_goal");
    assert.equal(parsed[0]?.answer, "Awareness");
  });

  it("accepts explicit content source yes answer", async () => {
    const parsed = await parseSurveyAnswer({
      userMessage: "있음, 마케팅 폴더 확인",
      pendingQuestions: ["content_source"],
      autoFillData: {
        content_source: "없음"
      }
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.question_id, "content_source");
    assert.equal(parsed[0]?.answer, "있음");
    assert.equal(parsed[0]?.source, "user");
  });

  it("builds chain input from survey answers", () => {
    const chainInput = buildChainInputFromSurvey([
      {
        question_id: "campaign_goal",
        answer: "Conversion",
        source: "user",
        answered_at: "2026-03-04T10:00:00.000Z"
      },
      {
        question_id: "channels",
        answer: "Instagram, Naver Blog",
        source: "user",
        answered_at: "2026-03-04T10:00:00.000Z"
      }
    ]);

    assert.match(chainInput, /목표: Conversion/);
    assert.match(chainInput, /채널: Instagram, Naver Blog/);
  });
});
