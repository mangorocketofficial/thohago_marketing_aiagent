import { env } from "../lib/env";
import {
  normalizeOrgId,
  readCachedResult,
  toCacheKeys,
  type BaseCallParams,
  type LlmCallResult,
  writeCachedResult
} from "./llm-client-shared";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

type AnthropicTextBlock = {
  type?: string;
  text?: string;
};

type AnthropicResponse = {
  content?: AnthropicTextBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

/**
 * Execute a single Anthropic call with cache lookup/write.
 */
export const callAnthropic = async (params: BaseCallParams): Promise<LlmCallResult> => {
  if (!env.anthropicApiKey) {
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "missing_api_key",
      errorMessage: "ANTHROPIC_API_KEY is missing."
    };
  }

  const orgId = normalizeOrgId(params.orgId);
  const { requestHash, cacheKey } = toCacheKeys({
    provider: "anthropic",
    model: env.anthropicModel,
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

  const requestHeaders = {
    "content-type": "application/json",
    "x-api-key": env.anthropicApiKey,
    "anthropic-version": "2023-06-01"
  };

  const buildRequestBody = (usePromptCaching: boolean) => {
    if (!usePromptCaching) {
      return {
        model: env.anthropicModel,
        max_tokens: params.maxTokens,
        messages: [{ role: "user", content: params.prompt }]
      };
    }

    return {
      model: env.anthropicModel,
      max_tokens: params.maxTokens,
      system: [
        {
          type: "text",
          text: "Follow the user instruction exactly. Return only the requested output.",
          cache_control: {
            type: "ephemeral"
          }
        }
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: params.prompt,
              cache_control: {
                type: "ephemeral"
              }
            }
          ]
        }
      ]
    };
  };

  const callApi = async (usePromptCaching: boolean) => {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(buildRequestBody(usePromptCaching))
    });
    const payload = (await response.json().catch(() => ({}))) as AnthropicResponse;
    return {
      response,
      payload
    };
  };

  try {
    let current = await callApi(env.anthropicPromptCachingEnabled);
    if (!current.response.ok && env.anthropicPromptCachingEnabled && current.response.status === 400) {
      current = await callApi(false);
    }

    const promptTokens =
      typeof current.payload.usage?.input_tokens === "number" && Number.isFinite(current.payload.usage.input_tokens)
        ? current.payload.usage.input_tokens
        : null;
    const completionTokens =
      typeof current.payload.usage?.output_tokens === "number" && Number.isFinite(current.payload.usage.output_tokens)
        ? current.payload.usage.output_tokens
        : null;

    if (!current.response.ok) {
      const errorMessage = current.payload.error?.message ?? "unknown";
      console.error(`[AI] Anthropic request failed (${current.response.status}): ${errorMessage}`);
      return {
        text: null,
        promptTokens,
        completionTokens,
        errorCode: `http_${current.response.status}`,
        errorMessage
      };
    }

    const block = current.payload.content?.find((entry) => entry.type === "text" && !!entry.text?.trim());
    const text = block?.text?.trim() ?? null;

    if (text) {
      await writeCachedResult({
        orgId,
        provider: "anthropic",
        model: env.anthropicModel,
        cacheKey,
        requestHash,
        text,
        promptTokens,
        completionTokens
      });
    }

    return {
      text,
      promptTokens,
      completionTokens,
      errorCode: null,
      errorMessage: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AI] Anthropic request error:", error);
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "request_error",
      errorMessage: message
    };
  }
};
