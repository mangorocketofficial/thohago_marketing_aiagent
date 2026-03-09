import type { SkillIntentInput, SkillIntentMatch } from "../types";

const SKILL_ID = "naverblog_generation";

const STRONG_PHRASES = [
  "네이버 블로그 글 써줘",
  "네이버 블로그 글 작성",
  "네이버 블로그 작성",
  "네이버 블로그 생성",
  "write blog post",
  "write naver blog",
  "generate blog post"
];

const BLOG_NOUNS = ["네이버", "블로그", "포스팅", "글", "blog", "post"];
const INSTAGRAM_TERMS = ["인스타", "인스타그램", "instagram", "insta"];
const ACTION_TERMS = ["써줘", "작성", "생성", "만들어", "만들어줘", "write", "create", "generate", "draft"];
const QUERY_TERMS = ["조회", "확인", "상태", "목록", "리스트", "status", "list", "query"];

const hasAny = (text: string, terms: string[]): boolean => terms.some((term) => text.includes(term));

/**
 * Resolve chat text into a naver blog generation intent score.
 */
export const matchNaverBlogIntent = (input: SkillIntentInput): SkillIntentMatch | null => {
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

  if (hasAny(message, INSTAGRAM_TERMS) && !hasAny(message, ["네이버", "블로그", "blog", "naver blog"])) {
    return null;
  }

  if (hasAny(message, STRONG_PHRASES)) {
    return {
      confidence: 0.95,
      reason: "strong_blog_generation_phrase"
    };
  }

  const hasBlogNoun = hasAny(message, BLOG_NOUNS);
  const hasActionTerm = hasAny(message, ACTION_TERMS);
  const hasQueryTerm = hasAny(message, QUERY_TERMS);

  if (hasBlogNoun && hasActionTerm && !hasQueryTerm) {
    return {
      confidence: 0.88,
      reason: "blog_noun_plus_action"
    };
  }

  return null;
};
