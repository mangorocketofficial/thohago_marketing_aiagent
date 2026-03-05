import { createHash } from "node:crypto";
import { env } from "../lib/env";
import { supabaseAdmin } from "../lib/supabase-admin";

export type LlmCachedResponse = {
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const isMissingCacheTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("llm_response_cache") &&
    (normalized.includes("could not find the table") || normalized.includes("does not exist"))
  );
};

const toStableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort((left, right) => left.localeCompare(right));
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    normalized[key] = toStableValue(source[key]);
  }
  return normalized;
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const buildLlmRequestHash = (value: unknown): string => {
  const serialized = JSON.stringify(toStableValue(value)) ?? "null";
  return sha256(serialized);
};

export const readLlmResponseCache = async (params: {
  orgId: string;
  cacheKey: string;
}): Promise<LlmCachedResponse | null> => {
  if (!env.llmResponseCacheEnabled) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("llm_response_cache")
    .select("response_text,prompt_tokens,completion_tokens,expires_at")
    .eq("org_id", params.orgId)
    .eq("cache_key", params.cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (isMissingCacheTableError(error)) {
      return null;
    }
    console.warn(`[LLM_CACHE] Read failed for org ${params.orgId}: ${error.message}`);
    return null;
  }

  if (!data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const text = asString(row.response_text, "").trim();
  if (!text) {
    return null;
  }

  return {
    text,
    promptTokens: asNumberOrNull(row.prompt_tokens),
    completionTokens: asNumberOrNull(row.completion_tokens)
  };
};

export const writeLlmResponseCache = async (params: {
  orgId: string;
  provider: string;
  model: string;
  cacheKey: string;
  requestHash: string;
  responseText: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  ttlSeconds?: number;
}): Promise<void> => {
  if (!env.llmResponseCacheEnabled) {
    return;
  }

  const ttlSeconds =
    typeof params.ttlSeconds === "number" && Number.isFinite(params.ttlSeconds) && params.ttlSeconds > 0
      ? Math.floor(params.ttlSeconds)
      : env.llmResponseCacheTtlSeconds;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const { error } = await supabaseAdmin.from("llm_response_cache").upsert(
    {
      cache_key: params.cacheKey,
      org_id: params.orgId,
      provider: params.provider,
      model: params.model,
      request_hash: params.requestHash,
      response_text: params.responseText,
      prompt_tokens: params.promptTokens ?? null,
      completion_tokens: params.completionTokens ?? null,
      expires_at: expiresAt
    },
    {
      onConflict: "cache_key",
      ignoreDuplicates: false
    }
  );

  if (error) {
    if (isMissingCacheTableError(error)) {
      return;
    }
    console.warn(`[LLM_CACHE] Write failed for org ${params.orgId}: ${error.message}`);
  }
};
