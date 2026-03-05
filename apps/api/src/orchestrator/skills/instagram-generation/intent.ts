import type { SkillIntentInput, SkillIntentMatch } from "../types";

const SKILL_ID = "instagram_generation";

const STRONG_PHRASES = [
  "인스타 게시물 만들어",
  "인스타그램 콘텐츠 생성",
  "인스타 포스트 작성",
  "create instagram post",
  "generate instagram post"
];

const PLATFORM_TERMS = ["인스타", "인스타그램", "instagram", "insta"];
const BLOG_TERMS = ["블로그", "naver blog", "네이버 블로그", "blog post"];
const CONTENT_TERMS = ["게시물", "포스트", "피드", "카드뉴스", "post", "feed"];
const ACTION_TERMS = ["만들어", "생성", "작성", "올려", "create", "make", "generate", "draft"];
const IMAGE_TERMS = ["이미지", "사진", "디자인", "image", "photo"];
const QUERY_TERMS = ["분석", "인사이트", "팔로워", "통계", "analytics", "insight", "status", "list", "조회"];

const hasAny = (text: string, terms: string[]): boolean => terms.some((term) => text.includes(term));

/**
 * Resolve chat text into instagram generation intent confidence.
 */
export const matchInstagramIntent = (input: SkillIntentInput): SkillIntentMatch | null => {
  if (input.state.active_skill === SKILL_ID) {
    return {
      confidence: 1,
      reason: "active_skill_continuation"
    };
  }

  if (input.session.current_step !== "await_user_input") {
    return null;
  }

  const message = input.normalizedMessage.trim();
  if (!message) {
    return null;
  }

  if (hasAny(message, BLOG_TERMS) && !hasAny(message, PLATFORM_TERMS)) {
    return null;
  }

  if (hasAny(message, STRONG_PHRASES)) {
    return {
      confidence: 0.95,
      reason: "strong_instagram_generation_phrase"
    };
  }

  const hasPlatform = hasAny(message, PLATFORM_TERMS);
  const hasAction = hasAny(message, ACTION_TERMS);
  const hasContent = hasAny(message, CONTENT_TERMS);
  const hasQuery = hasAny(message, QUERY_TERMS);
  const hasImage = hasAny(message, IMAGE_TERMS);

  if (hasPlatform && hasAction && !hasQuery) {
    const confidence = Math.min(0.99, 0.88 + (hasImage ? 0.05 : 0) + (hasContent ? 0.02 : 0));
    return {
      confidence,
      reason: "platform_plus_action"
    };
  }

  if (hasPlatform && hasContent && hasImage && !hasQuery) {
    return {
      confidence: 0.86,
      reason: "platform_content_image_combo"
    };
  }

  return null;
};
