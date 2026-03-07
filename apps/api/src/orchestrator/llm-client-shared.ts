import { buildLlmRequestHash, readLlmResponseCache, writeLlmResponseCache } from "./llm-cache";

export type LlmCallResult = {
  text: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type ProviderName = "anthropic" | "openai";

export type BaseCallParams = {
  prompt: string;
  maxTokens: number;
  temperature?: number;
  orgId?: string | null;
};

export const normalizeOrgId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
};

export const toCacheKeys = (params: {
  provider: ProviderName;
  model: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  orgId: string | null;
}): { requestHash: string; cacheKey: string | null } => {
  const requestHash = buildLlmRequestHash({
    provider: params.provider,
    model: params.model,
    prompt: params.prompt,
    max_tokens: params.maxTokens,
    temperature:
      typeof params.temperature === "number" && Number.isFinite(params.temperature)
        ? Math.max(0, Math.min(2, params.temperature))
        : null
  });

  const cacheKey =
    params.orgId === null
      ? null
      : buildLlmRequestHash({
          provider: params.provider,
          org_id: params.orgId,
          request_hash: requestHash
        });

  return {
    requestHash,
    cacheKey
  };
};

export const readCachedResult = async (params: {
  orgId: string | null;
  cacheKey: string | null;
}): Promise<LlmCallResult | null> => {
  if (!params.orgId || !params.cacheKey) {
    return null;
  }

  const cached = await readLlmResponseCache({
    orgId: params.orgId,
    cacheKey: params.cacheKey
  });
  if (!cached?.text) {
    return null;
  }

  return {
    text: cached.text,
    promptTokens: cached.promptTokens,
    completionTokens: cached.completionTokens,
    errorCode: null,
    errorMessage: null
  };
};

export const writeCachedResult = async (params: {
  orgId: string | null;
  provider: ProviderName;
  model: string;
  cacheKey: string | null;
  requestHash: string;
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): Promise<void> => {
  if (!params.orgId || !params.cacheKey || !params.text) {
    return;
  }

  await writeLlmResponseCache({
    orgId: params.orgId,
    provider: params.provider,
    model: params.model,
    cacheKey: params.cacheKey,
    requestHash: params.requestHash,
    responseText: params.text,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens
  });
};
