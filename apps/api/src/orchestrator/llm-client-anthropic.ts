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
const CREDIT_ERROR_COOLDOWN_MS = 5 * 60 * 1000;
const ANTHROPIC_SYSTEM_INSTRUCTION = [
  "You are a marketing strategy AI for Korean NGO organizations.",
  "Always respond in valid JSON when JSON is requested.",
  "All natural-language values must be in Korean unless explicitly stated otherwise.",
  "Do not wrap JSON in markdown code blocks.",
  "Follow the user instruction exactly."
].join("\n");

let anthropicCreditCooldownUntil = 0;

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

const isCreditBalanceError = (status: number, message: string): boolean => {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const hasBillingKeyword =
    normalized.includes("credit") ||
    normalized.includes("balance") ||
    normalized.includes("billing") ||
    normalized.includes("quota") ||
    normalized.includes("payment");
  const hasLimitKeyword =
    normalized.includes("insufficient") ||
    normalized.includes("too low") ||
    normalized.includes("exceeded") ||
    normalized.includes("exhausted");

  return (status === 400 || status === 402 || status === 429) && hasBillingKeyword && hasLimitKeyword;
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

  if (Date.now() < anthropicCreditCooldownUntil) {
    const retryAfterSec = Math.ceil((anthropicCreditCooldownUntil - Date.now()) / 1000);
    return {
      text: null,
      promptTokens: null,
      completionTokens: null,
      errorCode: "http_400",
      errorMessage: `Anthropic credit balance appears insufficient (cooldown active, retry in ~${retryAfterSec}s).`
    };
  }

  const orgId = normalizeOrgId(params.orgId);
  const { requestHash, cacheKey } = toCacheKeys({
    provider: "anthropic",
    model: env.anthropicModel,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
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
    const temperature =
      typeof params.temperature === "number" && Number.isFinite(params.temperature)
        ? Math.max(0, Math.min(1, params.temperature))
        : 0;

    if (!usePromptCaching) {
      return {
        model: env.anthropicModel,
        temperature,
        max_tokens: params.maxTokens,
        system: ANTHROPIC_SYSTEM_INSTRUCTION,
        messages: [{ role: "user", content: params.prompt }]
      };
    }

    return {
      model: env.anthropicModel,
      temperature,
      max_tokens: params.maxTokens,
      system: [
        {
          type: "text",
          text: ANTHROPIC_SYSTEM_INSTRUCTION,
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
      if (isCreditBalanceError(current.response.status, errorMessage)) {
        anthropicCreditCooldownUntil = Date.now() + CREDIT_ERROR_COOLDOWN_MS;
      }
      console.error(`[AI] Anthropic request failed (${current.response.status}, model=${env.anthropicModel}): ${errorMessage}`);
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
