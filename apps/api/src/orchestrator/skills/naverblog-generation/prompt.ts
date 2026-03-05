import { truncateToTokenBudget } from "@repo/rag";
import type { BlogGenerationContext } from "./context";

const REFERENCE_BUDGET = 2400;

/**
 * Assemble the final model prompt for naver blog post generation.
 */
export const buildNaverBlogPrompt = (context: BlogGenerationContext): string => {
  const reference = truncateToTokenBudget(
    [
      "[Activity Files]",
      context.activityFiles,
      context.campaignContext ? "[Campaign Context]" : "",
      context.campaignContext ?? ""
    ]
      .filter(Boolean)
      .join("\n\n"),
    REFERENCE_BUDGET
  );

  return [
    "[ROLE]",
    "You are a professional Korean content writer for Naver Blog.",
    "",
    "[TASK]",
    "Write one complete Korean blog post for Naver Blog.",
    `Topic: ${context.topic}`,
    "",
    "[BRAND_CONTEXT]",
    context.brandProfile,
    "",
    "[CONVERSATION_MEMORY]",
    context.conversationMemory,
    "",
    "[CONTENT_GUIDELINES]",
    "- Use natural Korean suitable for general Naver Blog readers.",
    "- Structure: title + intro + body with 2-4 section headings + conclusion.",
    "- Length: about 1500-3000 Korean characters.",
    "- Keep tone aligned with the brand context.",
    "- Include the topic keyword naturally in title and first paragraph.",
    "- End with 5-10 relevant hashtags.",
    "",
    "[REFERENCE_MATERIALS]",
    reference || "(No additional references)",
    "",
    "[OUTPUT_FORMAT]",
    "Return valid markdown only:",
    "# <title>",
    "<body paragraphs and headings>",
    "---",
    "#tag1 #tag2 #tag3"
  ].join("\n");
};
