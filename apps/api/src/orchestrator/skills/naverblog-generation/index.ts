import { HttpError } from "../../../lib/errors";
import { generateAndPersistNaverBlog } from "./generate";
import { matchNaverBlogIntent } from "./intent";
import type { Skill, SkillExecutionContext, SkillResult } from "../types";

const SKILL_ID = "naverblog_generation";
const SKILL_VERSION = "7.1.0";

const normalizeMessage = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const TOPIC_STOP_PHRASES = [
  "네이버 블로그 글 써줘",
  "네이버 블로그 작성",
  "네이버 블로그 생성",
  "블로그 글 써줘",
  "블로그 써줘",
  "write blog post",
  "generate blog post"
];

const extractTopicFromMessage = (message: string): string => {
  const normalized = normalizeMessage(message);
  let candidate = normalized;

  for (const phrase of TOPIC_STOP_PHRASES) {
    candidate = candidate.replaceAll(phrase, " ");
  }

  candidate = candidate.replace(/\s+/g, " ").trim();
  return candidate.length >= 2 ? candidate.slice(0, 120) : "";
};

const withTelemetry = (context: SkillExecutionContext, result: SkillResult, note: string): SkillResult => ({
  ...result,
  telemetry: {
    skillId: SKILL_ID,
    routeReason: context.routeReason,
    confidence: context.routeConfidence,
    note
  }
});

const readUserMessage = (context: SkillExecutionContext): string => {
  const content = context.deps.asString(context.event.payload?.content, "").trim();
  if (!content) {
    throw new HttpError(400, "invalid_payload", "payload.content is required for user_message.");
  }
  return content;
};

const handleGeneration = async (context: SkillExecutionContext): Promise<SkillResult> => {
  const userMessage = readUserMessage(context);

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    role: "user",
    content: userMessage
  });

  const topic = extractTopicFromMessage(userMessage);
  if (!topic) {
    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: [
        "네이버 블로그 글 생성을 시작할게요.",
        "어떤 주제로 작성할까요?",
        "예: `봄맞이 홈카페 인테리어 팁`, `초보 사장님을 위한 네이버 블로그 운영법`"
      ].join("\n")
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        last_error: null
      },
      completion: "none"
    };
  }

  try {
    const generated = await generateAndPersistNaverBlog({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      activityFolder: context.state.activity_folder,
      campaignId: context.state.campaign_id,
      topic,
      idempotencyKey: context.idempotencyKey
    });

    const successMessage = generated.reused
      ? `이미 생성된 네이버 블로그 초안을 찾았어요.\n\n주제: **${generated.topic}**`
      : `네이버 블로그 초안을 생성했어요.\n\n주제: **${generated.topic}**\n모델: ${generated.model}`;

    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: successMessage,
      metadata: {
        content_id: generated.contentId,
        slot_id: generated.slotId,
        topic: generated.topic,
        char_count: generated.body.length,
        generated_body: generated.body,
        local_save_suggestion: {
          relative_path: generated.localSaveSuggestion.relativePath,
          file_name: generated.localSaveSuggestion.fileName,
          encoding: "utf8"
        },
        source: generated.source,
        generation_model: generated.model,
        generation_reused: generated.reused
      }
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        content_id: generated.contentId,
        content_draft: generated.body,
        last_error: null
      },
      completion: "none"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation error";
    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: "네이버 블로그 생성 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요."
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        last_error: `naverblog_generation_failed:${message}`
      },
      completion: "none"
    };
  }
};

/**
 * Register the naver blog generation skill in the orchestrator router.
 */
export const createNaverBlogGenerationSkill = (): Skill => ({
  id: SKILL_ID,
  displayName: "Naver Blog Generation",
  version: SKILL_VERSION,
  priority: 90,
  handlesEvents: ["user_message"],
  matchIntent: matchNaverBlogIntent,
  execute: async (context: SkillExecutionContext): Promise<SkillResult> => {
    if (context.event.event_type !== "user_message") {
      return {
        handled: false,
        outcome: "no_transition",
        completion: "none",
        telemetry: {
          skillId: SKILL_ID,
          routeReason: context.routeReason,
          confidence: context.routeConfidence,
          note: `unsupported_event:${context.event.event_type}`
        }
      };
    }

    const result = await handleGeneration(context);
    return withTelemetry(context, result, "generate_naver_blog");
  }
});
