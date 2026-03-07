import { callAnthropic } from "./llm-client-anthropic";
import { callOpenAi } from "./llm-client-openai";
import type { LlmCallResult } from "./llm-client-shared";

export type { BaseCallParams, LlmCallResult } from "./llm-client-shared";
export { callAnthropic } from "./llm-client-anthropic";
export { callOpenAi } from "./llm-client-openai";

const isServerErrorCode = (errorCode: string): boolean => /^http_5\d\d$/.test(errorCode);
const isRateLimitErrorCode = (errorCode: string): boolean => errorCode === "http_429";
const isTimeoutErrorCode = (errorCode: string): boolean =>
  errorCode === "request_error" || errorCode === "http_408";

export const isAnthropicCreditExhaustedError = (result: LlmCallResult): boolean => {
  const errorCode = typeof result.errorCode === "string" ? result.errorCode.trim().toLowerCase() : "";
  const errorMessage = typeof result.errorMessage === "string" ? result.errorMessage.trim().toLowerCase() : "";
  if (!errorCode && !errorMessage) {
    return false;
  }

  if (errorCode === "http_402") {
    return true;
  }

  const hasCreditKeyword =
    errorMessage.includes("credit") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("billing") ||
    errorMessage.includes("balance") ||
    errorMessage.includes("payment");
  const hasExhaustedKeyword =
    errorMessage.includes("insufficient") ||
    errorMessage.includes("exceeded") ||
    errorMessage.includes("exhausted") ||
    errorMessage.includes("too low") ||
    errorMessage.includes("limit");

  if (hasCreditKeyword && hasExhaustedKeyword) {
    return true;
  }

  return errorCode === "http_429" && hasCreditKeyword;
};

export const shouldFallbackFromAnthropic = (result: LlmCallResult): boolean => {
  if (result.text) {
    return false;
  }

  const errorCode = typeof result.errorCode === "string" ? result.errorCode.trim().toLowerCase() : "";
  if (!errorCode) {
    return true;
  }

  if (isAnthropicCreditExhaustedError(result)) {
    return true;
  }
  if (isRateLimitErrorCode(errorCode)) {
    return true;
  }
  if (isServerErrorCode(errorCode)) {
    return true;
  }
  if (isTimeoutErrorCode(errorCode)) {
    return true;
  }
  if (errorCode === "missing_api_key") {
    return true;
  }

  return false;
};

/**
 * Try Anthropic first and fallback to OpenAI when fallback conditions are met.
 */
export const callWithFallback = async (params: {
  prompt: string;
  maxTokens: number;
  temperature?: number;
  orgId?: string | null;
  shouldFallback?: (anthropicResult: LlmCallResult) => boolean;
  onFallback?: (anthropicResult: LlmCallResult) => void;
}): Promise<LlmCallResult & { model: "claude" | "gpt-4o-mini" }> => {
  const anthropicResult = await callAnthropic({
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    orgId: params.orgId
  });

  if (anthropicResult.text) {
    return {
      ...anthropicResult,
      model: "claude"
    };
  }

  const fallbackDecision =
    typeof params.shouldFallback === "function"
      ? params.shouldFallback(anthropicResult)
      : shouldFallbackFromAnthropic(anthropicResult);
  if (!fallbackDecision) {
    return {
      ...anthropicResult,
      model: "claude"
    };
  }

  if (typeof params.onFallback === "function") {
    params.onFallback(anthropicResult);
  }

  const openAiResult = await callOpenAi({
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    orgId: params.orgId
  });

  if (openAiResult.text) {
    return {
      ...openAiResult,
      model: "gpt-4o-mini"
    };
  }

  return {
    text: null,
    promptTokens: openAiResult.promptTokens,
    completionTokens: openAiResult.completionTokens,
    errorCode: openAiResult.errorCode ?? anthropicResult.errorCode,
    errorMessage: openAiResult.errorMessage ?? anthropicResult.errorMessage,
    model: "gpt-4o-mini"
  };
};
