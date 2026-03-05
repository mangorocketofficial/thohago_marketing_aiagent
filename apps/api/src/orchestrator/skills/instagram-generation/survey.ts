import type { TemplateId } from "@repo/media-engine";
import {
  defaultInstagramSurveyState,
  type InstagramImageMode,
  type InstagramSurveyState
} from "./types";

const TOPIC_STOP_PHRASES = [
  "인스타 게시물 만들어줘",
  "인스타그램 콘텐츠 생성",
  "인스타 포스트 작성",
  "인스타 만들어줘",
  "instagram post"
];

const DEFAULT_TEMPLATE: TemplateId = "koica_cover_01";

export type SurveyAdvanceResult = {
  state: InstagramSurveyState;
  assistantMessage: string;
  ready: boolean;
};

/**
 * Parse unknown persisted survey state to safe in-memory shape.
 */
export const readSurveyState = (value: unknown): InstagramSurveyState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const phase = normalizePhase(row.phase);
  if (!phase) {
    return null;
  }

  return {
    phase,
    topic: readString(row.topic),
    imageMode: normalizeImageMode(row.imageMode),
    selectedImagePaths: Array.isArray(row.selectedImagePaths)
      ? row.selectedImagePaths
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : [],
    templateId: readString(row.templateId),
    completed_at: readString(row.completed_at)
  };
};

/**
 * Start a new survey state.
 */
export const startInstagramSurvey = (): SurveyAdvanceResult => ({
  state: defaultInstagramSurveyState(),
  assistantMessage: "어떤 주제로 인스타 게시물을 만들까요?",
  ready: false
});

/**
 * Progress one survey step with latest user message.
 */
export const advanceInstagramSurvey = (state: InstagramSurveyState, userMessage: string): SurveyAdvanceResult => {
  if (state.phase === "topic") {
    const topic = extractTopicFromMessage(userMessage);
    if (!topic) {
      return {
        state,
        assistantMessage: "주제를 한 문장으로 입력해주세요. 예: 봄 행사 안내",
        ready: false
      };
    }

    return {
      state: {
        ...state,
        phase: "image_selection",
        topic
      },
      assistantMessage: buildImageSelectionQuestion(),
      ready: false
    };
  }

  if (state.phase === "image_selection") {
    const imageMode = parseImageMode(userMessage);
    if (!imageMode) {
      return {
        state,
        assistantMessage: buildImageSelectionQuestion(),
        ready: false
      };
    }

    if (imageMode === "text_only") {
      return {
        state: {
          ...state,
          phase: "complete",
          imageMode,
          templateId: DEFAULT_TEMPLATE,
          completed_at: new Date().toISOString()
        },
        assistantMessage: "텍스트 중심 모드로 생성을 시작합니다.",
        ready: true
      };
    }

    return {
      state: {
        ...state,
        phase: "template_selection",
        imageMode
      },
      assistantMessage: buildTemplateSelectionQuestion(),
      ready: false
    };
  }

  if (state.phase === "template_selection") {
    const templateId = parseTemplateChoice(userMessage) ?? DEFAULT_TEMPLATE;
    return {
      state: {
        ...state,
        phase: "complete",
        templateId,
        completed_at: new Date().toISOString()
      },
      assistantMessage: "템플릿 선택 완료. 생성을 시작합니다.",
      ready: true
    };
  }

  return {
    state,
    assistantMessage: "생성 중입니다. 잠시만 기다려주세요.",
    ready: state.phase === "complete"
  };
};

/**
 * Build image selection prompt for mini survey.
 */
export const buildImageSelectionQuestion = (): string =>
  [
    "사용할 이미지를 어떻게 선택할까요?",
    "1) AI 자동 선택",
    "2) 직접 이미지 지정",
    "3) 텍스트 중심(이미지 최소)"
  ].join("\n");

/**
 * Build template selection prompt for mini survey.
 */
export const buildTemplateSelectionQuestion = (): string =>
  [
    "템플릿을 선택해주세요:",
    "1) KOICA 표지 카드"
  ].join("\n");

const parseImageMode = (value: string): InstagramImageMode | null => {
  const text = value.trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text === "1" || text.includes("자동") || text.includes("ai")) {
    return "auto";
  }
  if (text === "2" || text.includes("직접") || text.includes("수동")) {
    return "manual";
  }
  if (text === "3" || text.includes("텍스트") || text.includes("이미지 없이")) {
    return "text_only";
  }
  return null;
};

const parseTemplateChoice = (value: string): TemplateId | null => {
  const text = value.trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text === "1" || text.includes("koica") || text.includes("표지")) {
    return DEFAULT_TEMPLATE;
  }
  return DEFAULT_TEMPLATE;
};

const extractTopicFromMessage = (value: string): string => {
  let candidate = value.trim();
  if (!candidate) {
    return "";
  }

  for (const phrase of TOPIC_STOP_PHRASES) {
    candidate = candidate.replaceAll(phrase, " ");
  }

  candidate = candidate.replace(/\s+/g, " ").trim();
  return candidate.length >= 2 ? candidate.slice(0, 120) : "";
};

const normalizePhase = (value: unknown): InstagramSurveyState["phase"] | null => {
  if (value === "topic" || value === "image_selection" || value === "template_selection" || value === "generating" || value === "complete") {
    return value;
  }
  return null;
};

const normalizeImageMode = (value: unknown): InstagramImageMode | null => {
  if (value === "auto" || value === "manual" || value === "text_only") {
    return value;
  }
  return null;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
