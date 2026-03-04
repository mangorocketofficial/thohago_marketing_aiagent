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
  it("extracts goal and channels from initial message", async () => {
    const answers = await extractAnswersFromInitialMessage("인스타 중심 인지도 캠페인 기획해줘");
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
      userMessage: "네, 그렇게 진행해줘",
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

