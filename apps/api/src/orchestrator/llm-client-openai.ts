import { env } from "../lib/env";
import {
  normalizeOrgId,
  readCachedResult,
  toCacheKeys,
  type BaseCallParams,
  type LlmCallResult,
  writeCachedResult
} from "./llm-client-shared";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

/**
 * Execute a single OpenAI fallback call with cache lookup/write.
 */
export const callOpenAi = async (
  params: BaseCallParams & {
    temperature?: number;
  }
): Promise<LlmCallResult> => {
  if (!env.openAiApiKey) {
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "missing_openai_api_key",
      errorMessage: "OPENAI_API_KEY is missing."
    };
  }

  const orgId = normalizeOrgId(params.orgId);
  const { requestHash, cacheKey } = toCacheKeys({
    provider: "openai",
    model: OPENAI_FALLBACK_MODEL,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    orgId
  });

  const cached = await readCachedResult({
    orgId,
    cacheKey
  });
  if (cached?.text) {
    return cached;
  }

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_FALLBACK_MODEL,
        temperature:
          typeof params.temperature === "number" && Number.isFinite(params.temperature)
            ? Math.max(0, Math.min(2, params.temperature))
            : 0.1,
        max_tokens: params.maxTokens,
        messages: [
          {
            role: "system",
            content: "Follow the user instruction exactly. Return only the requested output."
          },
          {
            role: "user",
            content: params.prompt
          }
        ]
      })
    });

    const payload = (await response.json().catch(() => ({}))) as OpenAiChatCompletionResponse;
    const promptTokens =
      typeof payload.usage?.prompt_tokens === "number" && Number.isFinite(payload.usage.prompt_tokens)
        ? payload.usage.prompt_tokens
        : null;
    const completionTokens =
      typeof payload.usage?.completion_tokens === "number" && Number.isFinite(payload.usage.completion_tokens)
        ? payload.usage.completion_tokens
        : null;

    if (!response.ok) {
      const errorMessage = payload.error?.message ?? "unknown";
      console.error(`[AI] OpenAI request failed (${response.status}): ${errorMessage}`);
      return {
        text: null,
        promptTokens,
        completionTokens,
        errorCode: `http_${response.status}`,
        errorMessage
      };
    }

    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" && content.trim() ? content.trim() : null;
    if (!text) {
      return {
        text: null,
        promptTokens,
        completionTokens,
        errorCode: "empty_model_response",
        errorMessage: "OpenAI fallback model returned empty response."
      };
    }

    await writeCachedResult({
      orgId,
      provider: "openai",
      model: OPENAI_FALLBACK_MODEL,
      cacheKey,
      requestHash,
      text,
      promptTokens,
      completionTokens
    });

    return {
      text,
      promptTokens,
      completionTokens,
      errorCode: null,
      errorMessage: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AI] OpenAI request error:", error);
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "request_error",
      errorMessage: message
    };
  }
};
