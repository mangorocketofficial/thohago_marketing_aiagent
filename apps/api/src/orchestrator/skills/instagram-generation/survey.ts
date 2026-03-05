import type { TemplateId } from "../../../media/templates/schema";
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

const TEMPLATE_CHOICES: Record<string, TemplateId> = {
  "1": "center-image-bottom-text",
  "2": "fullscreen-overlay",
  "3": "collage-2x2",
  "4": "split-image-text"
};

const DEFAULT_TEMPLATE: TemplateId = "center-image-bottom-text";

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
  assistantMessage: '어떤 주제의 인스타 게시물을 만들까요?',
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
        assistantMessage: '주제를 한 문장으로 알려주세요. 예: "봄 나들이 행사 홍보"',
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
          templateId: "text-only-gradient",
          completed_at: new Date().toISOString()
        },
        assistantMessage: "좋아요. 텍스트 전용 템플릿으로 생성을 시작할게요.",
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
      assistantMessage: "템플릿 선택 완료. 생성을 시작할게요.",
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
    "활동 폴더에서 사용할 이미지가 있나요?",
    "1) 폴더에서 AI가 자동 선택",
    "2) 직접 이미지 지정",
    "3) 이미지 없이 텍스트 디자인만"
  ].join("\n");

/**
 * Build template selection prompt for mini survey.
 */
export const buildTemplateSelectionQuestion = (): string =>
  [
    "템플릿을 선택해주세요:",
    "1) 중앙 이미지 + 하단 텍스트",
    "2) 전면 이미지 + 오버레이 텍스트",
    "3) 콜라주 (2-4장)",
    "4) 자유형 (AI 추천)"
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
  if (TEMPLATE_CHOICES[text]) {
    return TEMPLATE_CHOICES[text];
  }
  if (text.includes("중앙")) {
    return "center-image-bottom-text";
  }
  if (text.includes("전면") || text.includes("오버레이")) {
    return "fullscreen-overlay";
  }
  if (text.includes("콜라주")) {
    return "collage-2x2";
  }
  if (text.includes("자유") || text.includes("추천")) {
    return "split-image-text";
  }
  return null;
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
