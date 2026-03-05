import { HttpError } from "../../../lib/errors";
import { generateAndPersistInstagram } from "./generate";
import { matchInstagramIntent } from "./intent";
import {
  advanceInstagramSurvey,
  buildImageSelectionQuestion,
  readSurveyState,
  startInstagramSurvey
} from "./survey";
import type { InstagramSurveyState } from "./types";
import type { Skill, SkillExecutionContext, SkillResult } from "../types";

const SKILL_ID = "instagram_generation";
const SKILL_VERSION = "7.2.0";

const TOPIC_STOP_PHRASES = [
  "인스타 게시물 만들어줘",
  "인스타그램 콘텐츠 생성",
  "인스타 포스트 작성",
  "인스타 만들어줘"
];

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

const extractTopicFromMessage = (message: string): string => {
  let candidate = message.trim();
  for (const phrase of TOPIC_STOP_PHRASES) {
    candidate = candidate.replaceAll(phrase, " ");
  }
  candidate = candidate.replace(/\s+/g, " ").trim();
  return candidate.length >= 2 ? candidate.slice(0, 120) : "";
};

const shouldSkipSurveyForCampaign = (context: SkillExecutionContext, survey: InstagramSurveyState | null): boolean =>
  !!context.state.campaign_id && !survey;

const askAssistant = async (context: SkillExecutionContext, content: string): Promise<void> => {
  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content
  });
};

const saveUserMessage = async (context: SkillExecutionContext, content: string): Promise<void> => {
  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    userId: context.session.created_by_user_id,
    role: "user",
    content
  });
};

const handleGeneration = async (context: SkillExecutionContext): Promise<SkillResult> => {
  const userMessage = readUserMessage(context);
  await saveUserMessage(context, userMessage);

  const existingSurvey = readSurveyState(context.state.instagram_survey ?? null);
  const extractedTopic = extractTopicFromMessage(userMessage);

  if (shouldSkipSurveyForCampaign(context, existingSurvey)) {
    const generated = await generateAndPersistInstagram({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      activityFolder: context.state.activity_folder,
      campaignId: context.state.campaign_id,
      topic: extractedTopic || "캠페인 인스타 콘텐츠",
      imageMode: "auto",
      templateId: "koica_cover_01",
      idempotencyKey: context.idempotencyKey
    });

    await context.deps.campaign.insertChatMessage({
      orgId: context.session.org_id,
      sessionId: context.session.id,
      role: "assistant",
      content: `인스타 콘텐츠 초안을 생성했어요.\n\n주제: **${generated.topic}**\n템플릿: ${generated.templateId}`,
      metadata: {
        content_id: generated.contentId,
        slot_id: generated.slotId,
        topic: generated.topic,
        template_id: generated.templateId,
        overlay_texts: generated.overlayTexts,
        image_file_ids: generated.imageFileIds,
        selected_image_paths: generated.selectedImagePaths,
        requires_local_compose: generated.requiresLocalCompose,
        local_save_suggestion: {
          relative_path: generated.localSaveSuggestion.relativePath,
          file_name: generated.localSaveSuggestion.fileName
        },
        source: generated.source,
        generation_model: generated.model,
        generation_reused: generated.reused,
        generated_caption: generated.caption,
        char_count: generated.caption.length
      }
    });

    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        content_id: generated.contentId,
        content_draft: generated.caption,
        last_error: null,
        instagram_survey: null
      },
      completion: "none"
    };
  }

  if (!existingSurvey) {
    if (extractedTopic) {
      const bootstrapState: InstagramSurveyState = {
        phase: "image_selection",
        topic: extractedTopic,
        imageMode: null,
        selectedImagePaths: [],
        templateId: null,
        completed_at: null
      };
      await askAssistant(context, buildImageSelectionQuestion());
      return {
        handled: true,
        outcome: "no_transition",
        statePatch: {
          instagram_survey: bootstrapState,
          last_error: null
        },
        completion: "none"
      };
    }

    const started = startInstagramSurvey();
    await askAssistant(context, started.assistantMessage);
    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        instagram_survey: started.state,
        last_error: null
      },
      completion: "none"
    };
  }

  const advanced = advanceInstagramSurvey(existingSurvey, userMessage);
  if (!advanced.ready) {
    await askAssistant(context, advanced.assistantMessage);
    return {
      handled: true,
      outcome: "no_transition",
      statePatch: {
        instagram_survey: advanced.state,
        last_error: null
      },
      completion: "none"
    };
  }

  const topic = advanced.state.topic?.trim() || extractedTopic || context.state.activity_folder;
  const generated = await generateAndPersistInstagram({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    activityFolder: context.state.activity_folder,
    campaignId: context.state.campaign_id,
    topic,
    imageMode: advanced.state.imageMode ?? "auto",
    templateId: advanced.state.templateId,
    manualImageSelections: advanced.state.selectedImagePaths,
    idempotencyKey: context.idempotencyKey
  });

  await context.deps.campaign.insertChatMessage({
    orgId: context.session.org_id,
    sessionId: context.session.id,
    role: "assistant",
    content: `인스타 콘텐츠 초안을 생성했어요.\n\n주제: **${generated.topic}**\n템플릿: ${generated.templateId}`,
    metadata: {
      content_id: generated.contentId,
      slot_id: generated.slotId,
      topic: generated.topic,
      template_id: generated.templateId,
      overlay_texts: generated.overlayTexts,
      image_file_ids: generated.imageFileIds,
      selected_image_paths: generated.selectedImagePaths,
      requires_local_compose: generated.requiresLocalCompose,
      local_save_suggestion: {
        relative_path: generated.localSaveSuggestion.relativePath,
        file_name: generated.localSaveSuggestion.fileName
      },
      source: generated.source,
      generation_model: generated.model,
      generation_reused: generated.reused,
      generated_caption: generated.caption,
      char_count: generated.caption.length
    }
  });

  return {
    handled: true,
    outcome: "no_transition",
    statePatch: {
      content_id: generated.contentId,
      content_draft: generated.caption,
      last_error: null,
      instagram_survey: {
        ...advanced.state,
        phase: "complete"
      }
    },
    completion: "none"
  };
};

/**
 * Register instagram content generation skill.
 */
export const createInstagramGenerationSkill = (): Skill => ({
  id: SKILL_ID,
  displayName: "Instagram Generation",
  version: SKILL_VERSION,
  priority: 85,
  handlesEvents: ["user_message"],
  matchIntent: matchInstagramIntent,
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

    try {
      const result = await handleGeneration(context);
      return withTelemetry(context, result, "generate_instagram_content");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown instagram generation error";
      await askAssistant(context, "인스타 콘텐츠 생성 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
      return withTelemetry(
        context,
        {
          handled: true,
          outcome: "no_transition",
          statePatch: {
            last_error: `instagram_generation_failed:${message}`
          },
          completion: "none"
        },
        "generate_instagram_content_failed"
      );
    }
  }
});
